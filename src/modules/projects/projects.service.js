import pool from '../../config/database.js';
import logger from '../../utils/logger.js';
import cacheService from '../../services/cache.service.js';

/**
 * Lấy số lượng journal và article của một project, có sử dụng cache Redis để tối ưu hiệu năng
 * @param {string|number} projectId
 * @param {string|number} subjectAreaId
 * @returns {Promise<{journal_count: number, article_count: number}>}
 */
export const getProjectStats = async (projectId, subjectAreaId) => {
  const cacheKey = `project:stats:${projectId}`;
  const cached = await cacheService.get(cacheKey);
  if (cached) return cached;

  try {
    // 1. Đếm số lượng journal và article từ config riêng biệt của project
    const statsQuery = `
      SELECT 
        (SELECT COUNT(DISTINCT journal_id) FROM "Project_Journal" WHERE project_id = $1)::integer as journal_count,
        (SELECT COUNT(DISTINCT ka.article_id) FROM "Project_Keyword" pk JOIN "Keyword_Article" ka ON ka.keyword_id = pk.keyword_id WHERE pk.project_id = $1)::integer as article_count
    `;
    const res = await pool.query(statsQuery, [projectId]);
    let journal_count = parseInt(res.rows[0].journal_count || 0, 10);
    let article_count = parseInt(res.rows[0].article_count || 0, 10);

    // 2. Cộng thêm số lượng từ Subject Area nếu project cấu hình area (dùng cache riêng cho area vì dữ liệu này rất lớn)
    if (subjectAreaId) {
      const saCacheKey = `sa:stats:${subjectAreaId}`;
      let saStats = await cacheService.get(saCacheKey);
      if (!saStats) {
        const saRes = await pool.query(`
          SELECT 
            COUNT(DISTINCT jsc.journal_id) as sa_j_count,
            COUNT(DISTINCT a.article_id) as sa_a_count
          FROM "Subject_Category" sc 
          JOIN "Journal_Subject_Category" jsc ON jsc.subject_category_id = sc.subject_category_id 
          JOIN "Volume" v ON v.journal_id = jsc.journal_id 
          JOIN "Issue" i ON i.volume_id = v.volume_id 
          JOIN "Article" a ON a.issue_id = i.issue_id 
          WHERE sc.subject_area_id = $1
        `, [subjectAreaId]);
        
        saStats = {
          journal_count: parseInt(saRes.rows[0].sa_j_count || 0, 10),
          article_count: parseInt(saRes.rows[0].sa_a_count || 0, 10)
        };
        await cacheService.set(saCacheKey, saStats, 86400); // Lưu cache 1 ngày cho Subject Area
      }
      journal_count += saStats.journal_count;
      article_count += saStats.article_count;
    }

    const finalStats = { journal_count, article_count };
    await cacheService.set(cacheKey, finalStats, 3600); // Lưu cache 1 giờ cho Project cụ thể
    return finalStats;
  } catch (error) {
    logger.error(`Error calculating project stats for project ${projectId}:`, error);
    return { journal_count: 0, article_count: 0 };
  }
};

/**
 * Lấy danh sách các project của một user
 * @param {string} userId
 * @returns {Promise<Array>}
 */
export const getUserProjects = async (userId, includeDeleted = false) => {
  const cacheKey = `project:user-list:${userId}${includeDeleted ? ':all' : ''}`;
  const cached = await cacheService.get(cacheKey);
  if (cached) return cached;

  const statusFilter = includeDeleted ? '' : `AND p.status != 'DELETED'`;

  const result = await pool.query(
    `SELECT 
       p.project_id, 
       p.user_id,
       p.title, 
       p.title as project_name, 
       sa.display_name as subject_area, 
       p.subject_area as subject_area_id,
       p.created_at,
       p.status,
       (SELECT COUNT(*) FROM "Project_Keyword" pk WHERE pk.project_id = p.project_id)::integer as keyword_count,
       CASE WHEN p.user_id = $1 THEN 'OWNER' ELSE pm.role END as user_role,
       json_build_object(
         'user_id', u_owner.user_id,
         'first_name', u_owner.first_name,
         'last_name', u_owner.last_name,
         'email', u_owner.email
       ) as owner,
       COALESCE(members_data.members, '[]'::json) as members
     FROM "Project" p 
     JOIN "user" u_owner ON u_owner.user_id = p.user_id
     LEFT JOIN "Project_Member" pm ON pm.project_id = p.project_id AND pm.user_id = $1 AND pm.status = 'ACCEPTED'
     LEFT JOIN LATERAL (
       SELECT json_agg(
         json_build_object(
           'user_id', pm2.user_id,
           'first_name', u.first_name,
           'last_name', u.last_name,
           'email', u.email,
           'role', pm2.role,
           'status', pm2.status
         )
       ) as members
       FROM "Project_Member" pm2
       JOIN "user" u ON u.user_id = pm2.user_id
       WHERE pm2.project_id = p.project_id
     ) members_data ON true
     LEFT JOIN "Subject_Area" sa ON sa.subject_area_id = p.subject_area
     WHERE (p.user_id = $1 OR pm.project_id IS NOT NULL)
       ${statusFilter}
     ORDER BY p.created_at DESC`,
    [userId]
  );

  const projects = result.rows;
  
  // Lấy các chỉ số thống kê song song và gán lại cho từng project
  await Promise.all(
    projects.map(async (project) => {
      const stats = await getProjectStats(project.project_id, project.subject_area_id);
      project.journal_count = stats.journal_count;
      project.article_count = stats.article_count;
    })
  );

  await cacheService.set(cacheKey, projects, 300); // 5 mins cache
  return projects;
};

/**
 * Lấy chi tiết một project bao gồm cấu hình Subject Area, Subject Categories và Journals
 * @param {string|number} projectId
 * @param {string} userId
 * @returns {Promise<Object|null>}
 */
export const getProjectById = async (projectId, userId) => {
  // 1. Lấy thông tin chung của project và Subject Area tương ứng
  const projectResult = await pool.query(
    `SELECT p.project_id, p.title, p.user_id, p.subject_area, p.created_at, p.status,
            sa.display_name as subject_area_name, sa.description as subject_area_description,
            CASE WHEN p.user_id = $2 THEN 'OWNER' ELSE pm.role END as user_role
     FROM "Project" p
     LEFT JOIN "Project_Member" pm ON pm.project_id = p.project_id AND pm.user_id = $2 AND pm.status = 'ACCEPTED'
     LEFT JOIN "Subject_Area" sa ON p.subject_area = sa.subject_area_id
     WHERE p.project_id = $1 AND (p.user_id = $2 OR pm.project_id IS NOT NULL)`,
    [projectId, userId]
  );

  if (projectResult.rows.length === 0) {
    return null;
  }

  const project = projectResult.rows[0];

  // 2. Lấy danh sách Subject Category đã cấu hình
  const categoriesResult = await pool.query(
    `SELECT sc.subject_category_id, sc.display_name, sc.description, sc.subject_area_id
     FROM "Subject_Category_Project" psc
     JOIN "Subject_Category" sc ON psc.subject_category_id = sc.subject_category_id
     WHERE psc.project_id = $1`,
    [projectId]
  );

  // 3. Lấy danh sách Journal đã cấu hình
  const journalsResult = await pool.query(
    `SELECT j.journal_id, j.display_name, j.issn, j.type, j.is_open_access
     FROM "Project_Journal" pj
     JOIN "Journal" j ON pj.journal_id = j.journal_id
     WHERE pj.project_id = $1`,
    [projectId]
  );

  // 4. Lấy danh sách Keyword đang theo dõi
  const keywordsResult = await pool.query(
    `SELECT k.keyword_id, k.display_name
     FROM "Project_Keyword" pk
     JOIN "Keyword" k ON pk.keyword_id = k.keyword_id
     WHERE pk.project_id = $1`,
    [projectId]
  );

  // 5. Tính toán Cảnh báo mới (24H)
  const alertsQuery = `
    WITH MatchedArticles AS (
      SELECT ka.article_id
      FROM "Project_Keyword" pk
      JOIN "Keyword_Article" ka ON ka.keyword_id = pk.keyword_id
      WHERE pk.project_id = $1
      UNION
      SELECT a.article_id
      FROM "Project" p
      JOIN "Subject_Category" sc ON sc.subject_area_id = p.subject_area
      JOIN "Journal_Subject_Category" jsc ON jsc.subject_category_id = sc.subject_category_id
      JOIN "Volume" v ON v.journal_id = jsc.journal_id
      JOIN "Issue" i ON i.volume_id = v.volume_id
      JOIN "Article" a ON a.issue_id = i.issue_id
      WHERE p.project_id = $1 AND p.subject_area IS NOT NULL
    ),
    MatchedData AS (
      SELECT a.article_id, a.created_at, a.publication_year
      FROM MatchedArticles ma
      JOIN "Article" a ON a.article_id = ma.article_id
    ),
    LatestYear AS (
      SELECT MAX(publication_year) as max_year
      FROM MatchedData
    )
    SELECT 
      COUNT(md.article_id) FILTER (WHERE md.created_at >= NOW() - INTERVAL '24 HOURS') AS today_count,
      COUNT(md.article_id) FILTER (WHERE md.publication_year = ly.max_year) AS current_year_count,
      COUNT(md.article_id) FILTER (WHERE md.publication_year = ly.max_year - 1) AS previous_year_count
    FROM MatchedData md
    CROSS JOIN LatestYear ly
    GROUP BY ly.max_year
  `;
  const alertsResult = await pool.query(alertsQuery, [projectId]);

  let todayCount = 0;
  let currentYearCount = 0;
  let previousYearCount = 0;
  let growthRate = 0.0;

  if (alertsResult.rows.length > 0) {
    todayCount = parseInt(alertsResult.rows[0].today_count) || 0;
    currentYearCount = parseInt(alertsResult.rows[0].current_year_count) || 0;
    previousYearCount = parseInt(alertsResult.rows[0].previous_year_count) || 0;

    if (previousYearCount === 0) {
      growthRate = currentYearCount > 0 ? 100.0 : 0.0;
    } else {
      growthRate = ((currentYearCount - previousYearCount) / previousYearCount) * 100.0;
    }
  }

  return {
    project_id: project.project_id,
    title: project.title,
    user_id: project.user_id,
    created_at: project.created_at,
    status: project.status,
    subject_area: project.subject_area ? {
      subject_area_id: project.subject_area,
      display_name: project.subject_area_name,
      description: project.subject_area_description
    } : null,
    subject_categories: categoriesResult.rows,
    journals: journalsResult.rows,
    watched_keywords: keywordsResult.rows.map(k => k.display_name),
    alerts_24h: {
      todayCount,
      currentYearCount,
      previousYearCount,
      growthRate: parseFloat(growthRate.toFixed(1))
    }
  };
};

/**
 * Helper để kiểm tra danh sách ID có tồn tại trong bảng tương ứng hay không
 * @param {Array<number|string>} ids - Danh sách ID cần kiểm tra
 * @param {string} tableName - Tên bảng trong cơ sở dữ liệu
 * @param {string} idColumnName - Tên cột ID của bảng cần kiểm tra
 * @returns {Promise<boolean>} Trả về true nếu tất cả các ID đều tồn tại, ngược lại trả về false
 */
const validateIdsExist = async (ids, tableName, idColumnName) => {
  if (!ids || ids.length === 0) return true;
  // Loại bỏ các ID trùng lặp
  const uniqueIds = [...new Set(ids)];

  // Thực hiện truy vấn để kiểm tra xem các ID có tồn tại không
  const query = `
    SELECT ${idColumnName} 
    FROM "${tableName}" 
    WHERE ${idColumnName} = ANY($1::bigint[])
  `;
  const result = await pool.query(query, [uniqueIds]);
  return result.rows.length === uniqueIds.length;
};

/**
 * Tạo một dự án mới và thiết lập các liên kết chuyên ngành / tạp chí tương ứng
 * @param {Object} projectData - Thông tin dự án cần tạo
 * @param {string} projectData.userId - ID của người dùng sở hữu dự án
 * @param {string} projectData.title - Tiêu đề của dự án
 * @param {number|string} [projectData.subject_area] - ID của lĩnh vực nghiên cứu chính
 * @param {Array<number|string>} [projectData.subject_category_ids] - Danh sách ID danh mục chuyên ngành liên kết
 * @param {Array<number|string>} [projectData.journal_ids] - Danh sách ID tạp chí liên kết
 * @returns {Promise<Object>} Trả về thông tin cơ bản của project vừa được tạo
 * @throws {Error} Ném lỗi nếu Subject Area, Subject Category hoặc Journal không tồn tại
 */
export const createProject = async ({ userId, title, subject_area, subject_category_ids = [], journal_ids = [] }) => {
  // 1. Kiểm tra sự tồn tại của subject_area
  if (subject_area) {
    const areaCheck = await pool.query(
      `SELECT 1 FROM "Subject_Area" WHERE subject_area_id = $1`,
      [subject_area]
    );
    if (areaCheck.rows.length === 0) {
      throw new Error(`Subject Area ID '${subject_area}' không tồn tại`);
    }
  }

  // 2. Kiểm tra sự tồn tại của tất cả subject_category_ids
  if (subject_category_ids.length > 0) {
    const categoriesValid = await validateIdsExist(subject_category_ids, 'Subject_Category', 'subject_category_id');
    if (!categoriesValid) {
      throw new Error('Một hoặc nhiều Subject Category ID không tồn tại trong hệ thống');
    }
  }

  // 3. Kiểm tra sự tồn tại của tất cả journal_ids
  if (journal_ids.length > 0) {
    const journalsValid = await validateIdsExist(journal_ids, 'Journal', 'journal_id');
    if (!journalsValid) {
      throw new Error('Một hoặc nhiều Journal ID không tồn tại trong hệ thống');
    }
  }

  // 4. Bắt đầu transaction để lưu dữ liệu
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Thêm bản ghi vào bảng Project
    const projectInsertResult = await client.query(
      `INSERT INTO "Project" (user_id, title, subject_area) 
       VALUES ($1, $2, $3) 
       RETURNING project_id, user_id, title, subject_area, created_at`,
      [userId, title, subject_area || null]
    );
    const newProject = projectInsertResult.rows[0];
    const projectId = newProject.project_id;

    // Thêm các liên kết vào bảng trung gian Subject_Category_Project
    if (subject_category_ids.length > 0) {
      const uniqueCategoryIds = [...new Set(subject_category_ids)];
      await client.query(
        `INSERT INTO "Subject_Category_Project" (project_id, subject_category_id) 
         SELECT $1, unnest($2::bigint[])`,
        [projectId, uniqueCategoryIds]
      );
    }

    // Thêm các liên kết vào bảng trung gian Project_Journal
    if (journal_ids.length > 0) {
      const uniqueJournalIds = [...new Set(journal_ids)];
      await client.query(
        `INSERT INTO "Project_Journal" (project_id, journal_id) 
         SELECT $1, unnest($2::bigint[])`,
        [projectId, uniqueJournalIds]
      );
    }

    await client.query('COMMIT');
    await cacheService.del(`project:user-list:${userId}`);

    // Tự động đồng bộ Project_Article_Scope trong nền để Analytics có dữ liệu
    syncProjectScope(projectId).catch(err => logger.error(`[Project Scope] Auto sync failed for project ${projectId}:`, err));

    return newProject;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Cập nhật thông tin của dự án, bao gồm cập nhật liên kết chuyên ngành và tạp chí
 * @param {string|number} projectId - ID của dự án cần cập nhật
 * @param {string} userId - ID của người dùng sở hữu dự án (để xác thực quyền)
 * @param {Object} updateData - Dữ liệu cập nhật
 * @param {string} [updateData.title] - Tiêu đề mới của dự án
 * @param {number|string} [updateData.subject_area] - ID mới của lĩnh vực nghiên cứu chính
 * @param {Array<number|string>} [updateData.subject_category_ids] - Danh sách ID danh mục chuyên ngành mới
 * @param {Array<number|string>} [updateData.journal_ids] - Danh sách ID tạp chí mới
 * @returns {Promise<boolean|null>} Trả về true nếu cập nhật thành công, null nếu dự án không tồn tại hoặc không thuộc sở hữu của user
 * @throws {Error} Ném lỗi nếu Subject Area, Subject Category hoặc Journal mới không tồn tại
 */
export const updateProject = async (projectId, userId, { title, subject_area, subject_category_ids, journal_ids }) => {
  // 1. Kiểm tra xem project có tồn tại và thuộc sở hữu của user không
  const projectCheck = await pool.query(
    `SELECT status FROM "Project" WHERE project_id = $1 AND user_id = $2`,
    [projectId, userId]
  );
  if (projectCheck.rows.length === 0) {
    return null;
  }

  if (projectCheck.rows[0].status === 'DELETED') {
    const err = new Error("Không thể cập nhật dự án đã bị xóa.");
    err.statusCode = 400;
    err.code = "PROJECT_ALREADY_DELETED";
    throw err;
  }

  // 2. Kiểm tra sự tồn tại của subject_area nếu được truyền vào
  if (subject_area) {
    const areaCheck = await pool.query(
      `SELECT 1 FROM "Subject_Area" WHERE subject_area_id = $1`,
      [subject_area]
    );
    if (areaCheck.rows.length === 0) {
      throw new Error(`Subject Area ID '${subject_area}' không tồn tại`);
    }
  }

  // 3. Kiểm tra sự tồn tại của tất cả subject_category_ids nếu được truyền vào
  if (subject_category_ids && subject_category_ids.length > 0) {
    const categoriesValid = await validateIdsExist(subject_category_ids, 'Subject_Category', 'subject_category_id');
    if (!categoriesValid) {
      throw new Error('Một hoặc nhiều Subject Category ID không tồn tại trong hệ thống');
    }
  }

  // 4. Kiểm tra sự tồn tại của tất cả journal_ids nếu được truyền vào
  if (journal_ids && journal_ids.length > 0) {
    const journalsValid = await validateIdsExist(journal_ids, 'Journal', 'journal_id');
    if (!journalsValid) {
      throw new Error('Một hoặc nhiều Journal ID không tồn tại trong hệ thống');
    }
  }

  // 5. Bắt đầu transaction để cập nhật dữ liệu
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Cập nhật thông tin cơ bản của project
    await client.query(
      `UPDATE "Project" 
       SET title = COALESCE($1, title), 
           subject_area = $2
       WHERE project_id = $3 AND user_id = $4`,
      [title, subject_area || null, projectId, userId]
    );

    // Cập nhật quan hệ Subject Category nếu mảng được truyền vào
    if (subject_category_ids) {
      // Xóa các quan hệ cũ
      await client.query(`DELETE FROM "Subject_Category_Project" WHERE project_id = $1`, [projectId]);

      // Thêm các quan hệ mới
      if (subject_category_ids.length > 0) {
        const uniqueCategoryIds = [...new Set(subject_category_ids)];
        await client.query(
          `INSERT INTO "Subject_Category_Project" (project_id, subject_category_id) 
           SELECT $1, unnest($2::bigint[])`,
          [projectId, uniqueCategoryIds]
        );
      }
    }

    // Cập nhật quan hệ Journal nếu mảng được truyền vào
    if (journal_ids) {
      // Xóa các quan hệ cũ
      await client.query(`DELETE FROM "Project_Journal" WHERE project_id = $1`, [projectId]);

      // Thêm các quan hệ mới
      if (journal_ids.length > 0) {
        const uniqueJournalIds = [...new Set(journal_ids)];
        await client.query(
          `INSERT INTO "Project_Journal" (project_id, journal_id) 
           SELECT $1, unnest($2::bigint[])`,
          [projectId, uniqueJournalIds]
        );
      }
    }

    await client.query('COMMIT');
    await cacheService.del(`project:user-list:${userId}`);
    await cacheService.del(`project:overview:${projectId}`);
    await cacheService.del(`project:stats:${projectId}`);

    // Tự động đồng bộ Project_Article_Scope khi cập nhật project
    syncProjectScope(projectId).catch(err => logger.error(`[Project Scope] Auto sync failed for project ${projectId}:`, err));

    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Xóa mềm một project (chỉ chủ sở hữu mới có quyền xóa)
 * @param {string|number} projectId
 * @param {string} userId
 * @returns {Promise<string>} Trạng thái trước khi xóa mềm (để ghi log)
 */
export const deleteProject = async (projectId, userId) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Kiểm tra xem project có tồn tại không
    const existCheck = await client.query(
      `SELECT user_id, status FROM "Project" WHERE project_id = $1`,
      [projectId]
    );
    if (existCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      const err = new Error("Không tìm thấy dự án.");
      err.statusCode = 404;
      err.code = "PROJECT_NOT_FOUND";
      throw err;
    }

    const project = existCheck.rows[0];

    // 2. Kiểm tra quyền sở hữu (chỉ owner mới được xóa)
    if (String(project.user_id) !== String(userId)) {
      await client.query('ROLLBACK');
      const err = new Error("Bạn không có quyền xóa dự án này (chỉ chủ sở hữu mới có quyền xóa).");
      err.statusCode = 403;
      err.code = "FORBIDDEN";
      throw err;
    }

    // 3. Kiểm tra nếu dự án đã bị xóa mềm trước đó
    if (project.status === 'DELETED') {
      await client.query('ROLLBACK');
      const err = new Error("Dự án này đã bị xóa trước đó.");
      err.statusCode = 400;
      err.code = "PROJECT_ALREADY_DELETED";
      throw err;
    }

    const previousStatus = project.status;

    // 4. Cập nhật status thành DELETED thay vì xóa bản ghi (Xóa mềm)
    await client.query(
      `UPDATE "Project" SET status = 'DELETED' WHERE project_id = $1 AND user_id = $2`,
      [projectId, userId]
    );

    // Lấy danh sách thành viên để xóa cache của họ nữa
    const membersRes = await client.query(
      `SELECT user_id FROM "Project_Member" WHERE project_id = $1 AND status = 'ACCEPTED'`,
      [projectId]
    );

    await client.query('COMMIT');

    // Xóa cache của chủ sở hữu và thành viên
    await cacheService.del(`project:user-list:${userId}`);
    await cacheService.del(`project:user-list:${userId}:all`);
    for (const member of membersRes.rows) {
      await cacheService.del(`project:user-list:${member.user_id}`);
      await cacheService.del(`project:user-list:${member.user_id}:all`);
    }
    await cacheService.del(`project:overview:${projectId}`);
    await cacheService.del(`project:stats:${projectId}`);
    await cacheService.del(`project:${projectId}:analytics`);

    return previousStatus; // Trả về status cũ để lưu vào log
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Khôi phục project bị xóa mềm (chỉ owner mới được khôi phục)
 * @param {string|number} projectId 
 * @param {string} userId 
 * @returns {Promise<string>} Trạng thái sau khi khôi phục
 */
export const restoreProject = async (projectId, userId) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const checkResult = await client.query(
      `SELECT user_id, status FROM "Project" WHERE project_id = $1`,
      [projectId]
    );
    if (checkResult.rows.length === 0) {
      await client.query('ROLLBACK');
      const err = new Error("Không tìm thấy dự án.");
      err.statusCode = 404;
      err.code = "PROJECT_NOT_FOUND";
      throw err;
    }

    const project = checkResult.rows[0];
    if (String(project.user_id) !== String(userId)) {
      await client.query('ROLLBACK');
      const err = new Error("Bạn không có quyền khôi phục dự án này (chỉ chủ sở hữu mới có quyền khôi phục).");
      err.statusCode = 403;
      err.code = "FORBIDDEN";
      throw err;
    }

    if (project.status !== 'DELETED') {
      await client.query('ROLLBACK');
      const err = new Error("Dự án không ở trạng thái đã xóa.");
      err.statusCode = 400;
      err.code = "PROJECT_NOT_DELETED";
      throw err;
    }

    // Lấy trạng thái trước đó từ bảng System_Log
    const logResult = await client.query(
      `SELECT old_data FROM "System_Log" 
       WHERE entity_table = 'Project' AND entity_id = $1 AND action = 'DELETE' 
       ORDER BY created_at DESC LIMIT 1`,
      [String(projectId)]
    );

    let previousStatus = 'INACTIVE'; // mặc định nếu không có log
    if (logResult.rows.length > 0 && logResult.rows[0].old_data && logResult.rows[0].old_data.status) {
      previousStatus = logResult.rows[0].old_data.status;
    }

    await client.query(
      `UPDATE "Project" SET status = $1 WHERE project_id = $2 AND user_id = $3`,
      [previousStatus, projectId, userId]
    );

    // Lấy danh sách thành viên để xóa cache của họ nữa
    const membersRes = await client.query(
      `SELECT user_id FROM "Project_Member" WHERE project_id = $1 AND status = 'ACCEPTED'`,
      [projectId]
    );

    await client.query('COMMIT');

    await cacheService.del(`project:user-list:${userId}`);
    await cacheService.del(`project:user-list:${userId}:all`);
    for (const member of membersRes.rows) {
      await cacheService.del(`project:user-list:${member.user_id}`);
      await cacheService.del(`project:user-list:${member.user_id}:all`);
    }
    await cacheService.del(`project:overview:${projectId}`);
    await cacheService.del(`project:stats:${projectId}`);
    await cacheService.del(`project:${projectId}:analytics`);

    return previousStatus;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};


/**
 * Lấy danh sách journal_id thuộc về một dự án.
 *
 * @async
 * @param {(number|string)} projectId - ID của dự án cần truy vấn.
 * @returns {Promise<number[]>} Mảng các journal_id.
 */
export const getJournalIdsByProjectId = async (projectId) => {
  try {
    const queryText = `
            SELECT pj.journal_id
            FROM "Project_Journal" pj
            WHERE pj.project_id = $1;
        `;

    const res = await pool.query(queryText, [Number(projectId)]);

    // Chỉ trả về mảng số
    return res.rows.map(row => Number(row.journal_id));
  } catch (error) {
    logger.error('Lỗi khi lấy journal_id của dự án:', error);
    throw error;
  }
};

/**
 * Lấy danh sách subject_category_id thuộc về các journal trong dự án.
 *
 * @async
 * @param {(number|string)} projectId - ID của dự án.
 * @returns {Promise<number[]>} Mảng các subject_category_id (không trùng).
 */
export const getCategoryIdsByProjectId = async (projectId) => {
  try {
    const queryText = `
            SELECT DISTINCT jsc.subject_category_id
            FROM "Project_Journal" pj
            JOIN "Journal_Subject_Category" jsc 
                ON pj.journal_id = jsc.journal_id
            WHERE pj.project_id = $1;
        `;

    const res = await pool.query(queryText, [Number(projectId)]);

    return res.rows.map(row => Number(row.subject_category_id));
  } catch (error) {
    logger.error('Lỗi khi lấy subject_category_id của dự án:', error);
    throw error;
  }
};

/**
 * Cập nhật trạng thái của project
 * @param {string|number} projectId
 * @param {string} userId
 * @param {string} status
 * @returns {Promise<boolean>}
 */
export const updateProjectStatus = async (projectId, userId, status) => {
  const result = await pool.query(
    `UPDATE "Project" SET status = $1 WHERE project_id = $2 AND user_id = $3 RETURNING *`,
    [status, projectId, userId]
  );
  if (result.rows.length > 0) {
    await cacheService.del(`project:user-list:${userId}`);
    await cacheService.del(`project:overview:${projectId}`);
    await cacheService.del(`project:stats:${projectId}`);
    return true;
  }
  return false;
};

/**
 * Lấy danh sách các bài viết liên quan dựa trên mảng ID tạp chí HOẶC mảng ID danh mục thuộc dự án.
 * Ưu tiên các bài viết thỏa mãn cả hai điều kiện, sắp xếp theo năm xuất bản mới nhất.
 *
 * @async
 * @param {Array<number|string>} journalIds - Mảng chứa các ID của tạp chí thuộc dự án.
 * @param {Array<number|string>} categoryIds - Mảng chứa các ID của danh mục thuộc dự án.
 * @param {Object} options - Cấu hình tùy chọn cho dữ liệu.
 * @param {number} [options.limit=5] - Số lượng bài viết giới hạn lấy ra.
 * @returns {Promise<Array<{article_id: (number|string), title: string, abstract: string, publication_year: number, doi: string, journal_name: string}>>} Danh sách bài viết gợi ý.
 */
export const getRelatedArticles = async (journalIds, categoryIds, { limit = 5 }) => {
  try {
    // Phòng hờ trường hợp mảng truyền vào bị rỗng để tránh lỗi SQL ANY()
    const finalJournalIds = journalIds.length > 0 ? journalIds : [-1];
    const finalCategoryIds = categoryIds.length > 0 ? categoryIds : [-1];

    const queryText = `
            SELECT DISTINCT
                a.article_id,
                a.title,
                a.abstract,
                a.publication_year,
                a.doi,
                j.display_name AS journal_name -- Lấy ra tên tạp chí tương ứng như yêu cầu bài toán
            FROM "Article" a
            -- Luồng đi ngược cây thư mục theo sơ đồ DB của bạn: Article -> Issue -> Volume -> Journal
            JOIN "Issue" i ON a.issue_id = i.issue_id
            JOIN "Volume" v ON i.volume_id = v.volume_id
            JOIN "Journal" j ON v.journal_id = j.journal_id
            -- Kết nối sang bảng danh mục để kiểm tra chuyên ngành hẹp
            LEFT JOIN "Journal_Subject_Category" jc ON j.journal_id = jc.journal_id
            -- Điều kiện lọc động "Hoặc/Và": Thỏa mãn tạp chí HOẶC thỏa mãn chuyên ngành đều lấy
            WHERE v.journal_id = ANY($1) 
               OR jc.subject_category_id = ANY($2) 
            -- Sắp xếp: Ưu tiên bài viết mới xuất bản nhất, tiếp theo là bài tạo mới nhất trong DB
            ORDER BY a.publication_year DESC, a.article_id DESC
            LIMIT $3;
        `;

    const values = [finalJournalIds, finalCategoryIds, limit];
    const res = await pool.query(queryText, values);
    return res.rows;

  } catch (error) {
    logger.error('Lỗi khi lấy bài viết liên quan tại Service:', error);
    throw error;
  }
};

/**
 * Lấy dữ liệu phân tích/thống kê của một dự án (Trending Charts)
 * 
 * @async
 * @param {number|string} projectId - ID dự án.
 * @param {string} userId - ID người dùng sở hữu dự án.
 * @returns {Promise<Object|null>} Dữ liệu phân tích hoặc null nếu dự án không tồn tại/không thuộc quyền sở hữu.
 */
export const getProjectAnalytics = async (projectId, userId) => {
  try {
    // 1. Xác thực sự tồn tại và quyền sở hữu/thành viên dự án
    const projectCheck = await pool.query(
      `SELECT 1 FROM "Project" p
       LEFT JOIN "Project_Member" pm ON pm.project_id = p.project_id AND pm.user_id = $2 AND pm.status = 'ACCEPTED'
       WHERE p.project_id = $1 AND (p.user_id = $2 OR pm.project_id IS NOT NULL)`,
      [Number(projectId), userId]
    );
    if (projectCheck.rows.length === 0) {
      return null;
    }

    // 2. Chart 1 (Article Volume Trend)
    const articleTrendQuery = `
            SELECT 
                a.publication_year::integer AS year,
                COUNT(a.article_id)::integer AS article_count
            FROM "Article" a
            JOIN "Issue" i ON a.issue_id = i.issue_id
            JOIN "Volume" v ON i.volume_id = v.volume_id
            JOIN "Project_Journal" pj ON v.journal_id = pj.journal_id
            WHERE pj.project_id = $1 AND a.is_deleted = false
            GROUP BY a.publication_year
            ORDER BY a.publication_year ASC
        `;
    const articleTrendRes = await pool.query(articleTrendQuery, [Number(projectId)]);

    // 3. Chart 2 (Journal Metrics Comparison)
    const metricsCompareQuery = `
            WITH latest_years AS (
                SELECT jr.journal_id, MAX(jr.year) AS max_year
                FROM "Journal_Ranking" jr
                JOIN "Project_Journal" pj ON jr.journal_id = pj.journal_id
                WHERE pj.project_id = $1
                GROUP BY jr.journal_id
            ),
            deduped_rankings AS (
                SELECT DISTINCT ON (jr.journal_id, rm.code, jr.subject_category_id)
                    j.display_name AS journal_name,
                    j.journal_id::text AS journal_id,
                    rm.code AS metric_code,
                    rm.display_name AS metric_name,
                    rm.metric_type,
                    jr.year,
                    jr.value_txt,
                    jr.value_float,
                    jr.value_int
                FROM "Journal_Ranking" jr
                JOIN latest_years ly ON jr.journal_id = ly.journal_id AND jr.year = ly.max_year
                JOIN "Ranking_Metric" rm ON jr.metric_id = rm.metric_id
                JOIN "Journal" j ON jr.journal_id = j.journal_id
                ORDER BY jr.journal_id, rm.code, jr.subject_category_id, jr.journal_ranking_id DESC
            )
            SELECT * FROM deduped_rankings
            ORDER BY journal_name ASC, metric_code ASC
        `;
    const metricsCompareRes = await pool.query(metricsCompareQuery, [Number(projectId)]);

    const journalMetrics = metricsCompareRes.rows.map(row => {
      let value = null;
      if (row.metric_type === 'QUARTILE') {
        value = row.value_txt;
      } else if (row.metric_type === 'SCORE') {
        value = row.value_float !== null ? Number(row.value_float) : null;
      } else if (row.metric_type === 'INTEGER') {
        value = row.value_int !== null ? Number(row.value_int) : null;
      } else {
        value = row.value_txt !== null ? row.value_txt :
          row.value_float !== null ? Number(row.value_float) :
            row.value_int !== null ? Number(row.value_int) : null;
      }
      return {
        journal_name: row.journal_name,
        journal_id: row.journal_id,
        metric_code: row.metric_code,
        metric_name: row.metric_name,
        metric_type: row.metric_type,
        value,
        year: row.year
      };
    });

    return {
      article_volume_trend: articleTrendRes.rows,
      journal_metrics_comparison: journalMetrics
    };
  } catch (error) {
    logger.error('Lỗi khi lấy dữ liệu phân tích của dự án:', error);
    throw error;
  }
};

const buildChart = ({ type, label, rows }) => ({
  type,
  labels: rows.map(row => String(row.label)),
  datasets: [
    {
      label,
      data: rows.map(row => Number(row.count) || 0)
    }
  ]
});

/**
 * Lấy dữ liệu tổng quan cho tab Tổng quan & Biểu đồ của project.
 *
 * @async
 * @param {number|string} projectId - ID dự án.
 * @param {string} userId - ID người dùng sở hữu dự án.
 * @returns {Promise<Object|null>} Dữ liệu overview hoặc null nếu project không thuộc user.
 */
export const getProjectOverview = async (projectId, userId) => {
  const cacheKey = `project:overview:${projectId}`;
  const cached = await cacheService.get(cacheKey);
  if (cached) return cached;

  try {
    const projectCheck = await pool.query(
      `SELECT 1 FROM "Project" p
       LEFT JOIN "Project_Member" pm ON pm.project_id = p.project_id AND pm.user_id = $2 AND pm.status = 'ACCEPTED'
       WHERE p.project_id = $1 AND (p.user_id = $2 OR pm.project_id IS NOT NULL)`,
      [Number(projectId), userId]
    );

    if (projectCheck.rows.length === 0) {
      return null;
    }

    const matchedArticlesCte = `
            WITH MatchedData AS (
                SELECT ka.article_id, v.journal_id
                FROM "Project_Keyword" pk
                JOIN "Keyword_Article" ka ON ka.keyword_id = pk.keyword_id
                JOIN "Article" a ON a.article_id = ka.article_id
                JOIN "Issue" i ON i.issue_id = a.issue_id
                JOIN "Volume" v ON v.volume_id = i.volume_id
                WHERE pk.project_id = $1 AND COALESCE(a.is_deleted, false) = false

                UNION

                SELECT a.article_id, v.journal_id
                FROM "Project_Journal" pj
                JOIN "Volume" v ON v.journal_id = pj.journal_id
                JOIN "Issue" i ON i.volume_id = v.volume_id
                JOIN "Article" a ON a.issue_id = i.issue_id
                WHERE pj.project_id = $1 AND COALESCE(a.is_deleted, false) = false

                UNION

                SELECT a.article_id, v.journal_id
                FROM "Project" p
                JOIN "Subject_Category" sc ON sc.subject_area_id = p.subject_area
                JOIN "Journal_Subject_Category" jsc ON jsc.subject_category_id = sc.subject_category_id
                JOIN "Volume" v ON v.journal_id = jsc.journal_id
                JOIN "Issue" i ON i.volume_id = v.volume_id
                JOIN "Article" a ON a.issue_id = i.issue_id
                WHERE p.project_id = $1
                  AND p.subject_area IS NOT NULL
                  AND COALESCE(a.is_deleted, false) = false
            )
        `;

    const summaryQuery = `${matchedArticlesCte}
            SELECT
                COUNT(DISTINCT md.article_id)::integer AS total_articles,
                (SELECT COUNT(*) FROM "Project_Keyword" WHERE project_id = $1)::integer AS total_keywords,
                COUNT(DISTINCT md.journal_id)::integer AS total_journals,
                MAX(a.created_at) AS last_updated_at
            FROM MatchedData md
            LEFT JOIN "Article" a ON a.article_id = md.article_id`;

    const trendQuery = `${matchedArticlesCte}
            SELECT
                a.publication_year::text AS label,
                COUNT(DISTINCT md.article_id)::integer AS count
            FROM MatchedData md
            JOIN "Article" a ON a.article_id = md.article_id
            WHERE a.publication_year IS NOT NULL
            GROUP BY a.publication_year
            ORDER BY a.publication_year ASC`;

    const subjectAreaQuery = `${matchedArticlesCte}
            SELECT
                sa.display_name AS label,
                COUNT(DISTINCT md.article_id)::integer AS count
            FROM MatchedData md
            JOIN "Journal_Subject_Category" jsc ON jsc.journal_id = md.journal_id
            JOIN "Subject_Category" sc ON sc.subject_category_id = jsc.subject_category_id
            JOIN "Subject_Area" sa ON sa.subject_area_id = sc.subject_area_id
            GROUP BY sa.display_name
            ORDER BY count DESC, sa.display_name ASC`;

    const publicationTypeQuery = `${matchedArticlesCte}
            SELECT
                COALESCE(j.type, 'Unknown') AS label,
                COUNT(DISTINCT md.article_id)::integer AS count
            FROM MatchedData md
            JOIN "Journal" j ON j.journal_id = md.journal_id
            GROUP BY COALESCE(j.type, 'Unknown')
            ORDER BY count DESC, label ASC`;

    const [summaryResult, trendResult, subjectAreaResult, publicationTypeResult] = await Promise.all([
      pool.query(summaryQuery, [Number(projectId)]),
      pool.query(trendQuery, [Number(projectId)]),
      pool.query(subjectAreaQuery, [Number(projectId)]),
      pool.query(publicationTypeQuery, [Number(projectId)])
    ]);

    const summary = summaryResult.rows[0] || {};

    const overviewData = {
      summary: {
        totalArticles: Number(summary.total_articles) || 0,
        totalKeywords: Number(summary.total_keywords) || 0,
        totalJournals: Number(summary.total_journals) || 0,
        lastUpdatedAt: summary.last_updated_at || null
      },
      charts: {
        publicationTrend: buildChart({
          type: 'line',
          label: 'Publications',
          rows: trendResult.rows
        }),
        subjectAreaDistribution: buildChart({
          type: 'donut',
          label: 'Subject Areas',
          rows: subjectAreaResult.rows
        }),
        publicationTypeDistribution: buildChart({
          type: 'donut',
          label: 'Publication Types',
          rows: publicationTypeResult.rows
        })
      }
    };

    await cacheService.set(cacheKey, overviewData, 600); // 10 mins cache
    return overviewData;
  } catch (error) {
    logger.error('Lỗi khi lấy dữ liệu tổng quan của dự án:', error);
    throw error;
  }
};



/**
 * Automatically sync Project_Article_Scope after a project is created or updated
 * This materialized view is required by the Analytics service
 */
export const syncProjectScope = async (projectId) => {
  try {
    // 1. Clear existing scope
    await pool.query('DELETE FROM "Project_Article_Scope" WHERE project_id = $1::bigint', [projectId]);

    // 2. Lấy thông tin project (để lấy subject_area)
    const projectRes = await pool.query('SELECT subject_area FROM "Project" WHERE project_id = $1::bigint', [projectId]);
    if (projectRes.rows.length === 0) return;
    const project = projectRes.rows[0];

    // 3. Thu thập tất cả subject_category_id từ subject_area và Subject_Category_Project
    let catIds = [];
    if (project.subject_area) {
      const saCats = await pool.query(
        'SELECT subject_category_id FROM "Subject_Category" WHERE subject_area_id = $1 AND COALESCE(is_deleted, false) = false',
        [project.subject_area]
      );
      catIds.push(...saCats.rows.map(r => r.subject_category_id));
    }

    const catsRes = await pool.query('SELECT subject_category_id FROM "Subject_Category_Project" WHERE project_id = $1::bigint', [projectId]);
    catIds.push(...catsRes.rows.map(r => r.subject_category_id));
    catIds = [...new Set(catIds.map(id => String(id)))];

    if (catIds.length > 0) {
      await pool.query(`
        INSERT INTO "Project_Article_Scope" (project_id, article_id, publication_year)
        SELECT DISTINCT $1::bigint, a.article_id, a.publication_year
        FROM "Article" a
        WHERE a.primary_topic IN (
          SELECT topic_id FROM "Topic" WHERE subject_category_id = ANY($2::bigint[])
        )
        ON CONFLICT DO NOTHING;
      `, [projectId, catIds]);

      await pool.query(`
        INSERT INTO "Project_Article_Scope" (project_id, article_id, publication_year)
        SELECT DISTINCT $1::bigint, a.article_id, a.publication_year
        FROM "Sub_Topic" st
        JOIN "Topic" sub_topic ON st.topic_id = sub_topic.topic_id
        JOIN "Article" a ON st.article_id = a.article_id
        WHERE sub_topic.subject_category_id = ANY($2::bigint[])
        ON CONFLICT DO NOTHING;
      `, [projectId, catIds]);
    }

    // 4. Lấy project keywords
    const kwsRes = await pool.query('SELECT keyword_id FROM "Project_Keyword" WHERE project_id = $1::bigint', [projectId]);
    const kwIds = [...new Set(kwsRes.rows.map(r => String(r.keyword_id)))];

    if (kwIds.length > 0) {
      await pool.query(`
        INSERT INTO "Project_Article_Scope" (project_id, article_id, publication_year)
        SELECT DISTINCT $1::bigint, a.article_id, a.publication_year
        FROM "Keyword_Article" ka
        JOIN "Article" a ON ka.article_id = a.article_id
        WHERE ka.keyword_id = ANY($2::bigint[])
        ON CONFLICT DO NOTHING;
      `, [projectId, kwIds]);
    }

    logger.info(`[Scope Sync] Project ${projectId} scope synced successfully`);
  } catch (error) {
    logger.error(`[Scope Sync] Error syncing Project_Article_Scope for project ${projectId}:`, error);
  }
};
