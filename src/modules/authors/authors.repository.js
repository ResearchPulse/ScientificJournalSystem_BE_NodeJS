import pool from "../../config/database.js";
import logger from "../../utils/logger.js";
import cacheService from "../../services/cache.service.js";

/**
 * Lấy thông tin tác giả theo ID
 */
export const getAuthorById = async (authorId) => {
  try {
    const queryText = `SELECT * FROM "Author" WHERE "author_id" = $1`;
    const res = await pool.query(queryText, [authorId]);
    return res.rows[0];
  } catch (error) {
    logger.error("Lỗi khi lấy thông tin tác giả theo ID:", error);
    throw error;
  }
};

/**
 * Phân tích danh mục chuyên ngành (Subject Category) nghiên cứu của một tác giả
 */
export const getAuthorAreasBreakdownService = async (authorId) => {
  try {
    const queryText = `
            WITH author_category_stats AS (
                SELECT 
                    sc.subject_category_id,
                    sc.display_name AS raw_category_name,
                    COUNT(DISTINCT a.article_id) AS total_articles
                FROM "Author_Article" aa
                JOIN "Article" a ON aa.article_id = a.article_id
                JOIN "Issue" i ON a.issue_id = i.issue_id
                JOIN "Volume" v ON i.volume_id = v.volume_id
                JOIN "Journal" j ON v.journal_id = j.journal_id
                JOIN "Journal_Subject_Category" jsc ON j.journal_id = jsc.journal_id
                JOIN "Subject_Category" sc ON jsc.subject_category_id = sc.subject_category_id
                WHERE aa.author_id = $1
                GROUP BY sc.subject_category_id, sc.display_name
            )
            SELECT 
                subject_category_id,
                raw_category_name AS category_name,
                total_articles AS article_count,
                ROUND(
                    (total_articles::numeric / NULLIF(SUM(total_articles) OVER (), 0)) * 100, 
                    2
                )::float AS percentage
            FROM author_category_stats
            ORDER BY total_articles DESC;
        `;
    const res = await pool.query(queryText, [authorId]);
    return res.rows;
  } catch (error) {
    logger.error("Xuất hiện lỗi khi phân tích lĩnh vực nghiên cứu của tác giả:", error);
    throw error;
  }
};

/**
 * Lấy danh sách bài viết của một tác giả với phân trang an toàn.
 */
export const getAuthorArticlesService = async (authorId, limit, page) => {
  try {
    const safeLimit = Math.max(1, parseInt(limit) || 10);
    const safePage = Math.max(1, parseInt(page) || 1);
    const safeOffset = (safePage - 1) * safeLimit;

    const countQuery = `
      SELECT COUNT(DISTINCT a.article_id)::integer AS total
      FROM "Article" a
      JOIN "Author_Article" aa ON a.article_id = aa.article_id
      WHERE aa.author_id = $1
    `;

    const dataQuery = `
      SELECT 
        a.article_id,
        a.title,
        a.abstract,
        a.publication_year,
        a.doi,
        COALESCE(a."citation_count", 0) AS cited_by_count,
        COALESCE(a."citation_count", 0) AS citation_count,
        a.primary_topic,
        a.created_at
      FROM "Article" a
      JOIN "Author_Article" aa ON a.article_id = aa.article_id
      WHERE aa.author_id = $1
      ORDER BY a.publication_year DESC, a.article_id DESC
      LIMIT $2 OFFSET $3
    `;

    const cacheKey = `author:articles:${authorId}:${safeLimit}:${safePage}`;
    const cachedData = await cacheService.get(cacheKey);
    if (cachedData) return cachedData;

    const [countResult, dataResult] = await Promise.all([
      pool.query(countQuery, [authorId]),
      pool.query(dataQuery, [authorId, safeLimit, safeOffset]),
    ]);

    const total = countResult.rows[0]?.total || 0;

    const result = {
      items: dataResult.rows,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        total_pages: Math.max(1, Math.ceil(total / safeLimit)),
      },
    };

    await cacheService.set(cacheKey, result, 900);
    return result;
  } catch (error) {
    logger.error("Lỗi khi lấy bài viết của tác giả:", error);
    throw error;
  }
};

/**
 * Lấy bảng xếp hạng tác giả với phân trang.
 */
export const getAuthorLeaderboardService = async (limit, page, subject_area = "", period = "all") => {
  try {
    const safeLimit = Math.max(1, parseInt(limit) || 10);
    const safePage = Math.max(1, parseInt(page) || 1);
    const safeOffset = (safePage - 1) * safeLimit;
    const trimmedArea = String(subject_area || "").trim();
    const cleanPeriod = String(period || "all").trim().toLowerCase();

    const cacheKey = `author:leaderboard:${safeLimit}:${safePage}:${trimmedArea}:${cleanPeriod}`;
    const cachedData = await cacheService.get(cacheKey);
    if (cachedData) return cachedData;

    let periodArticleFilter = "";
    if (cleanPeriod === "month") {
      periodArticleFilter = "AND a.created_at >= NOW() - INTERVAL '30 days'";
    } else if (cleanPeriod === "year") {
      periodArticleFilter = "AND a.publication_year >= EXTRACT(YEAR FROM CURRENT_DATE) - 1";
    }

    let countResult;
    let dataResult;

    if (trimmedArea || periodArticleFilter) {
      const targetJournalsCTE = trimmedArea ? `
        target_journals AS (
          SELECT DISTINCT jsc.journal_id
          FROM "Subject_Area" sa
          JOIN "Subject_Category" sc ON sa.subject_area_id = sc.subject_area_id
          JOIN "Journal_Subject_Category" jsc ON sc.subject_category_id = jsc.subject_category_id
          WHERE sa.display_name ILIKE $1 OR sa.subject_area_id::text = $1
        ),
      ` : "";

      const targetAuthorsQuery = trimmedArea ? `
        SELECT DISTINCT aa.author_id
        FROM target_journals tj
        JOIN "Volume" v ON tj.journal_id = v.journal_id
        JOIN "Issue" i ON v.volume_id = i.volume_id
        JOIN "Article" a ON i.issue_id = a.issue_id
        JOIN "Author_Article" aa ON a.article_id = aa.article_id
        WHERE 1=1 ${periodArticleFilter}
      ` : `
        SELECT DISTINCT aa.author_id
        FROM "Author_Article" aa
        JOIN "Article" a ON aa.article_id = a.article_id
        WHERE 1=1 ${periodArticleFilter}
      `;

      const countQuery = `
        WITH ${targetJournalsCTE}
        target_authors AS (
          ${targetAuthorsQuery}
        )
        SELECT COUNT(*)::integer AS total
        FROM "Author" au
        JOIN target_authors ta ON au.author_id = ta.author_id
        WHERE COALESCE(au.is_deleted, false) = false
      `;

      const dataQuery = `
        WITH ${targetJournalsCTE}
        target_authors AS (
          ${targetAuthorsQuery}
        )
        SELECT 
          au.author_id,
          au.orcid,
          au.display_name,
          au.url_image,
          COALESCE(au.works_count, 0) AS works_count,
          COALESCE(au.cited_by_count, 0) AS cited_by_count,
          COALESCE(au.h_index, 0) AS h_index,
          COALESCE(au.i10_index, 0) AS i10_index,
          ROW_NUMBER() OVER (
            ORDER BY 
              au.h_index DESC NULLS LAST, 
              au.cited_by_count DESC NULLS LAST, 
              au.i10_index DESC NULLS LAST, 
              au.works_count DESC NULLS LAST
          ) AS final_rank
        FROM "Author" au
        JOIN target_authors ta ON au.author_id = ta.author_id
        WHERE COALESCE(au.is_deleted, false) = false
        ORDER BY final_rank ASC
        LIMIT ${trimmedArea ? "$2 OFFSET $3" : "$1 OFFSET $2"};
      `;

      const queryParams = trimmedArea ? [trimmedArea] : [];
      const dataParams = trimmedArea ? [trimmedArea, safeLimit, safeOffset] : [safeLimit, safeOffset];

      [countResult, dataResult] = await Promise.all([
        pool.query(countQuery, queryParams),
        pool.query(dataQuery, dataParams),
      ]);
    } else {
      const countQuery = `
        SELECT COUNT(*)::integer AS total
        FROM "Author"
        WHERE COALESCE(is_deleted, false) = false
      `;

      const dataQuery = `
        SELECT 
          author_id,
          orcid,
          display_name,
          url_image,
          COALESCE(works_count, 0) AS works_count,
          COALESCE(cited_by_count, 0) AS cited_by_count,
          COALESCE(h_index, 0) AS h_index,
          COALESCE(i10_index, 0) AS i10_index,
          ROW_NUMBER() OVER (
            ORDER BY 
              h_index DESC NULLS LAST, 
              cited_by_count DESC NULLS LAST, 
              i10_index DESC NULLS LAST, 
              works_count DESC NULLS LAST
          ) AS final_rank
        FROM "Author"
        WHERE COALESCE(is_deleted, false) = false
        ORDER BY final_rank ASC
        LIMIT $1 OFFSET $2;
      `;

      [countResult, dataResult] = await Promise.all([
        pool.query(countQuery),
        pool.query(dataQuery, [safeLimit, safeOffset]),
      ]);
    }

    const total = countResult.rows[0]?.total || 0;
    const authors = dataResult.rows;

    await attachSubjectAreasToAuthors(authors, trimmedArea);

    const response = {
      items: authors,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        total_pages: Math.max(1, Math.ceil(total / safeLimit)),
      },
    };

    await cacheService.set(cacheKey, response, 3600);
    return response;
  } catch (error) {
    logger.error("Lỗi khi lấy bảng xếp hạng tác giả:", error);
    throw error;
  }
};

export const isAuthorExists = async (authorId) => {
  try {
    const queryText = `SELECT 1 FROM "Author" WHERE "author_id" = $1`;
    const res = await pool.query(queryText, [authorId]);
    return res.rowCount > 0;
  } catch (error) {
    logger.error("Lỗi khi kiểm tra tồn tại của tác giả:", error);
    throw error;
  }
};

export const checkAuthorsExistence = async (authorIds) => {
  try {
    if (!authorIds || authorIds.length === 0) {
      return [];
    }

    const queryText = `
            SELECT author_id
            FROM "Author"
            WHERE author_id = ANY($1)
        `;

    const result = await pool.query(queryText, [authorIds]);
    const existingAuthorIds = result.rows.map((row) => Number(row.author_id));
    const normalizedAuthorIds = authorIds.map((id) => Number(id));
    const nonExistingAuthorIds = normalizedAuthorIds.filter(
      (id) => !existingAuthorIds.includes(id),
    );

    return nonExistingAuthorIds;
  } catch (error) {
    logger.error("Lỗi khi kiểm tra tồn tại của các tác giả:", error);
    throw error;
  }
};

export const createAuthorArticleRelationships = async (articleId, authorIds) => {
  try {
    if (!authorIds || authorIds.length === 0) return;

    const uniqueAuthorIds = [...new Set(
      authorIds
        .map((id) => Number(id))
        .filter((id) => !isNaN(id) && id > 0)
    )];

    if (uniqueAuthorIds.length === 0) return;

    const query = `
            INSERT INTO "Author_Article" (article_id, author_id)
            SELECT $1, unnest($2::bigint[])
            ON CONFLICT DO NOTHING
        `;

    await pool.query(query, [articleId, uniqueAuthorIds]);
    logger.info(`Đã tạo ${uniqueAuthorIds.length} quan hệ tác giả - bài báo`);
  } catch (error) {
    logger.error("Lỗi khi tạo quan hệ tác giả - bài báo:", error);
    throw error;
  }
};

export const updateAuthorArticleRelationships = async (articleId, authorIds) => {
  try {
    if (!articleId) throw new Error("Thiếu articleId khi gọi hàm updateAuthorArticleRelationships");

    const deleteQuery = `DELETE FROM "Author_Article" WHERE "article_id" = $1;`;
    await pool.query(deleteQuery, [articleId]);

    await createAuthorArticleRelationships(articleId, authorIds);
    logger.info(`Đã cập nhật làm mới toàn bộ quan hệ tác giả cho bài báo ID: ${articleId}`);
  } catch (error) {
    logger.error(`Lỗi khi cập nhật quan hệ tác giả cho bài báo ID ${articleId}:`, error);
    throw error;
  }
};

/**
 * Gắn danh sách lĩnh vực nghiên cứu (subject areas) hàng đầu cho danh sách tác giả
 */
const attachSubjectAreasToAuthors = async (authors = [], preferredArea = "") => {
  if (!authors || authors.length === 0) return authors;

  try {
    const authorIds = authors.map((a) => a.author_id);
    const areasQuery = `
      SELECT 
        aa.author_id,
        sa.display_name AS subject_area_name,
        COUNT(DISTINCT a.article_id) AS article_count
      FROM "Author_Article" aa
      JOIN "Article" a ON aa.article_id = a.article_id
      JOIN "Issue" i ON a.issue_id = i.issue_id
      JOIN "Volume" v ON i.volume_id = v.volume_id
      JOIN "Journal_Subject_Category" jsc ON v.journal_id = jsc.journal_id
      JOIN "Subject_Category" sc ON jsc.subject_category_id = sc.subject_category_id
      JOIN "Subject_Area" sa ON sc.subject_area_id = sa.subject_area_id
      WHERE aa.author_id = ANY($1::bigint[])
      GROUP BY aa.author_id, sa.display_name
      ORDER BY aa.author_id, article_count DESC
    `;
    const areasRes = await pool.query(areasQuery, [authorIds]);

    const areasMap = {};
    for (const row of areasRes.rows) {
      const aId = String(row.author_id);
      if (!areasMap[aId]) {
        areasMap[aId] = [];
      }
      if (areasMap[aId].length < 3) {
        areasMap[aId].push(row.subject_area_name);
      }
    }

    const trimmedPref = preferredArea ? preferredArea.trim().toLowerCase() : "";

    for (const author of authors) {
      const aId = String(author.author_id);
      const assignedAreas = areasMap[aId] ? [...areasMap[aId]] : [];

      if (trimmedPref && !assignedAreas.some((name) => name.toLowerCase() === trimmedPref)) {
        assignedAreas.unshift(preferredArea.trim());
      }

      author.subject_areas = assignedAreas;
      author.subject_area = assignedAreas[0] || null;
    }
  } catch (err) {
    logger.warn("Không thể lấy danh sách lĩnh vực cho tác giả:", err);
    for (const author of authors) {
      author.subject_areas = preferredArea ? [preferredArea.trim()] : [];
      author.subject_area = preferredArea ? preferredArea.trim() : null;
    }
  }

  return authors;
};

export const getAllAuthors = async ({
  page = 1,
  limit = 10,
  search = "",
  sort = "impact",
  subject_area = "",
  country = "",
}) => {
  const safePage = Math.max(1, parseInt(page) || 1);
  const safeLimit = Math.max(1, Math.min(100, parseInt(limit) || 10));
  const offset = (safePage - 1) * safeLimit;
  const searchPattern = `%${search.trim()}%`;
  const sortKey = String(sort || "impact").toLowerCase();
  const trimmedArea = String(subject_area || "").trim();

  const orderByMap = {
    impact: `COALESCE(au.h_index, 0) DESC, COALESCE(au.cited_by_count, 0) DESC, COALESCE(au.works_count, 0) DESC, au.display_name ASC`,
    h_index: `COALESCE(au.h_index, 0) DESC, COALESCE(au.cited_by_count, 0) DESC, COALESCE(au.works_count, 0) DESC, au.display_name ASC`,
    citations: `COALESCE(au.cited_by_count, 0) DESC, COALESCE(au.h_index, 0) DESC, COALESCE(au.works_count, 0) DESC, au.display_name ASC`,
    articles: `COALESCE(au.works_count, 0) DESC, COALESCE(au.h_index, 0) DESC, COALESCE(au.cited_by_count, 0) DESC, au.display_name ASC`,
    name: `au.display_name ASC`,
  };
  const orderByClause = orderByMap[sortKey] || orderByMap.impact;

  const cacheKey = `authors:all:${safePage}:${safeLimit}:${search.trim()}:${sortKey}:${trimmedArea}:${country.trim()}`;
  const cachedData = await cacheService.get(cacheKey);
  if (cachedData) return cachedData;

  let countResult;
  let dataResult;

  if (trimmedArea) {
    const countQuery = `
      WITH target_journals AS (
        SELECT DISTINCT jsc.journal_id
        FROM "Subject_Area" sa
        JOIN "Subject_Category" sc ON sa.subject_area_id = sc.subject_area_id
        JOIN "Journal_Subject_Category" jsc ON sc.subject_category_id = jsc.subject_category_id
        WHERE sa.display_name ILIKE $1 OR sa.subject_area_id::text = $1
      ),
      target_authors AS (
        SELECT DISTINCT aa.author_id
        FROM target_journals tj
        JOIN "Volume" v ON tj.journal_id = v.journal_id
        JOIN "Issue" i ON v.volume_id = i.volume_id
        JOIN "Article" a ON i.issue_id = a.issue_id
        JOIN "Author_Article" aa ON a.article_id = aa.article_id
      )
      SELECT COUNT(*) AS total
      FROM "Author" au
      JOIN target_authors ta ON au.author_id = ta.author_id
      WHERE au.is_deleted = false
        AND ($2 = '%%' OR (
          LOWER(au.display_name) LIKE LOWER($2) OR
          LOWER(COALESCE(au.last_known_institution, '')) LIKE LOWER($2)
        ))
    `;

    const dataQuery = `
      WITH target_journals AS (
        SELECT DISTINCT jsc.journal_id
        FROM "Subject_Area" sa
        JOIN "Subject_Category" sc ON sa.subject_area_id = sc.subject_area_id
        JOIN "Journal_Subject_Category" jsc ON sc.subject_category_id = jsc.subject_category_id
        WHERE sa.display_name ILIKE $1 OR sa.subject_area_id::text = $1
      ),
      target_authors AS (
        SELECT DISTINCT aa.author_id
        FROM target_journals tj
        JOIN "Volume" v ON tj.journal_id = v.journal_id
        JOIN "Issue" i ON v.volume_id = i.volume_id
        JOIN "Article" a ON i.issue_id = a.issue_id
        JOIN "Author_Article" aa ON a.article_id = aa.article_id
      )
      SELECT 
        au.author_id, au.orcid, au.display_name, au.url_image, au.openalex_id,
        au.works_count, au.cited_by_count, au.h_index, au.i10_index,
        au.last_known_institution, au.last_known_institution_id
      FROM "Author" au
      JOIN target_authors ta ON au.author_id = ta.author_id
      WHERE au.is_deleted = false
        AND ($2 = '%%' OR (
          LOWER(au.display_name) LIKE LOWER($2) OR
          LOWER(COALESCE(au.last_known_institution, '')) LIKE LOWER($2)
        ))
      ORDER BY ${orderByClause}
      LIMIT $3 OFFSET $4
    `;

    [countResult, dataResult] = await Promise.all([
      pool.query(countQuery, [trimmedArea, searchPattern]),
      pool.query(dataQuery, [trimmedArea, searchPattern, safeLimit, offset]),
    ]);
  } else {
    const countQuery = `
      SELECT COUNT(*) AS total FROM "Author" au
      WHERE au.is_deleted = false
        AND ($1 = '%%' OR (
          LOWER(au.display_name) LIKE LOWER($1) OR
          LOWER(COALESCE(au.last_known_institution, '')) LIKE LOWER($1)
        ))
    `;

    const dataQuery = `
      SELECT 
        au.author_id, au.orcid, au.display_name, au.url_image, au.openalex_id,
        au.works_count, au.cited_by_count, au.h_index, au.i10_index,
        au.last_known_institution, au.last_known_institution_id
      FROM "Author" au
      WHERE au.is_deleted = false
        AND ($1 = '%%' OR (
          LOWER(au.display_name) LIKE LOWER($1) OR
          LOWER(COALESCE(au.last_known_institution, '')) LIKE LOWER($1)
        ))
      ORDER BY ${orderByClause}
      LIMIT $2 OFFSET $3
    `;

    [countResult, dataResult] = await Promise.all([
      pool.query(countQuery, [searchPattern]),
      pool.query(dataQuery, [searchPattern, safeLimit, offset]),
    ]);
  }

  const total = parseInt(countResult.rows[0]?.total || 0, 10);
  const authors = dataResult.rows;

  await attachSubjectAreasToAuthors(authors, trimmedArea);

  const result = {
    data: authors,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      total_pages: Math.max(1, Math.ceil(total / safeLimit)),
    },
  };

  await cacheService.set(cacheKey, result, 300);
  return result;
};

export const createAuthor = async (data) => {
  const {
    display_name,
    orcid = null,
    url_image = null,
    works_count = null,
    cited_by_count = null,
    h_index = null,
    i10_index = null,
    last_known_institution = null,
    last_known_institution_id = null,
  } = data;

  const { rows } = await pool.query(
    `INSERT INTO "Author" (
      display_name, orcid, url_image,
      works_count, cited_by_count, h_index, i10_index,
      last_known_institution, last_known_institution_id
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    RETURNING *`,
    [
      display_name, orcid, url_image, works_count, cited_by_count, h_index, 
      i10_index, last_known_institution, last_known_institution_id,
    ],
  );

  return rows[0];
};

export const updateAuthor = async (id, data) => {
  const allowedFields = [
    "display_name", "orcid", "url_image", "works_count", "cited_by_count", 
    "h_index", "i10_index", "last_known_institution", "last_known_institution_id",
  ];

  const existing = await pool.query(
    `SELECT author_id FROM "Author" WHERE author_id = $1 AND is_deleted = false`,
    [id],
  );

  if (!existing.rows.length) {
    const error = new Error("Tác giả không tồn tại");
    error.statusCode = 404;
    error.code = "AUTHOR_NOT_FOUND";
    throw error;
  }

  const updateParts = [];
  const values = [];
  let idx = 1;

  for (const field of allowedFields) {
    if (data[field] !== undefined) {
      updateParts.push(`"${field}" = $${idx}`);
      values.push(data[field]);
      idx++;
    }
  }

  values.push(id);
  const { rows } = await pool.query(
    `UPDATE "Author" SET ${updateParts.join(", ")}
     WHERE author_id = $${idx} AND is_deleted = false
     RETURNING *`,
    values,
  );

  return rows[0];
};

export const deleteAuthor = async (id) => {
  const existing = await pool.query(
    `SELECT author_id, is_deleted FROM "Author" WHERE author_id = $1`,
    [id],
  );

  if (!existing.rows.length) {
    const error = new Error("Tác giả không tồn tại");
    error.statusCode = 404;
    error.code = "AUTHOR_NOT_FOUND";
    throw error;
  }

  if (existing.rows[0].is_deleted) {
    const error = new Error("Tác giả đã bị xóa trước đó");
    error.statusCode = 400;
    error.code = "AUTHOR_ALREADY_DELETED";
    throw error;
  }

  const { rows } = await pool.query(
    `UPDATE "Author" SET is_deleted = true
     WHERE author_id = $1
     RETURNING author_id, display_name, is_deleted`,
    [id],
  );

  return rows[0];
};

export const restoreAuthor = async (id) => {
  const existing = await pool.query(
    `SELECT author_id, is_deleted FROM "Author" WHERE author_id = $1`,
    [id],
  );

  if (!existing.rows.length) {
    const error = new Error("Tác giả không tồn tại");
    error.statusCode = 404;
    error.code = "AUTHOR_NOT_FOUND";
    throw error;
  }

  if (!existing.rows[0].is_deleted) {
    const error = new Error("Tác giả đang active, không cần restore");
    error.statusCode = 400;
    error.code = "AUTHOR_ALREADY_ACTIVE";
    throw error;
  }

  const { rows } = await pool.query(
    `UPDATE "Author" SET is_deleted = false
     WHERE author_id = $1
     RETURNING author_id, display_name, is_deleted`,
    [id],
  );

  return rows[0];
};
