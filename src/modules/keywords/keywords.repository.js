import pool from "../../config/database.js";
import logger from "../../utils/logger.js";
import cacheService from "../../services/cache.service.js";

export const getTrendingKeywords = async (projectId, queryParams) => {
  const limit = Math.min(parseInt(queryParams.limit) || 20, 100);
  const sortBy = ["count", "score"].includes(queryParams.sort_by)
    ? queryParams.sort_by
    : "count";
  const orderClause =
    sortBy === "score"
      ? "avg_score DESC, count DESC"
      : "count DESC, avg_score DESC";

  const query = `
    SELECT 
      k.keyword_id,
      k.display_name                      AS keyword,
      COUNT(ka.article_id)                AS count,
      ROUND(AVG(ka.score)::numeric, 2)    AS avg_score,
      ROUND(SUM(ka.score)::numeric, 2)    AS total_score
    FROM "Project_Keyword" pk
    JOIN "Project" p          ON p.project_id  = pk.project_id
    JOIN "Keyword" k          ON k.keyword_id  = pk.keyword_id
    JOIN "Keyword_Article" ka ON ka.keyword_id = k.keyword_id
    JOIN "Article" a          ON a.article_id  = ka.article_id
    WHERE pk.project_id = $1
    GROUP BY k.keyword_id, k.display_name
    ORDER BY ${orderClause}
    LIMIT $2;
  `;

  const { rows } = await pool.query(query, [projectId, limit]);

  if (!rows.length) return { total: 0, keywords: [] };

  return {
    total: rows.length,
    sort_by: sortBy,
    keywords: rows.map((k) => ({
      id: k.keyword_id,
      keyword: k.keyword,
      count: parseInt(k.count),
      avg_score: parseFloat(k.avg_score),
      total_score: parseFloat(k.total_score),
    })),
  };
};

export const getWatchedKeywordArticles = async (
  projectId,
  userId,
  queryParams,
) => {
  const page = Math.max(parseInt(queryParams.page) || 1, 1);
  const limit = Math.min(parseInt(queryParams.limit) || 10, 50);
  const filter = queryParams.filter || 'all'; 
  const offset = (page - 1) * limit;

  const projectCheck = await pool.query(
    `SELECT p.project_id FROM "Project" p
     LEFT JOIN "Project_Member" pm ON pm.project_id = p.project_id AND pm.user_id = $2 AND pm.status = 'ACCEPTED'
     WHERE p.project_id = $1 AND (p.user_id = $2 OR pm.project_id IS NOT NULL)`,
    [projectId, userId],
  );

  if (!projectCheck.rows.length) {
    const error = new Error(
      "Project không tồn tại hoặc không thuộc quyền sở hữu",
    );
    error.statusCode = 400;
    throw error;
  }
  
  const unionPart = filter === 'keyword' ? '' : `
      UNION
      
      SELECT a.article_id, NULL::bigint AS keyword_id, p.subject_area AS subject_area_id
      FROM "Project" p
      JOIN "Subject_Category" sc ON sc.subject_area_id = p.subject_area
      JOIN "Journal_Subject_Category" jsc ON jsc.subject_category_id = sc.subject_category_id
      JOIN "Volume" v ON v.journal_id = jsc.journal_id
      JOIN "Issue" i ON i.volume_id = v.volume_id
      JOIN "Article" a ON a.issue_id = i.issue_id
      WHERE p.project_id = $1 AND p.subject_area IS NOT NULL
  `;
  
  const countQuery = `
    WITH MatchedArticles AS (
      SELECT ka.article_id, ka.keyword_id, NULL::bigint AS subject_area_id
      FROM "Project_Keyword" pk
      JOIN "Keyword_Article" ka ON ka.keyword_id = pk.keyword_id
      WHERE pk.project_id = $1
      ${unionPart}
    )
    SELECT COUNT(*) AS total FROM (SELECT DISTINCT article_id FROM MatchedArticles) AS unique_articles
  `;

  const dataQuery = `
    WITH MatchedArticles AS (
      SELECT ka.article_id, ka.keyword_id, NULL::bigint AS subject_area_id
      FROM "Project_Keyword" pk
      JOIN "Keyword_Article" ka ON ka.keyword_id = pk.keyword_id
      WHERE pk.project_id = $1
      ${unionPart}
    )
    SELECT 
      a.article_id,
      a.title,
      a.abstract,
      a.publication_year,
      a.doi,
      ARRAY_REMOVE(ARRAY_AGG(DISTINCT k.display_name), NULL) AS matched_keywords,
      ARRAY_REMOVE(ARRAY_AGG(DISTINCT sa.display_name), NULL) AS matched_areas,
      COALESCE(
          (
              SELECT json_agg(json_build_object(
                  'author_id', au."author_id"::text,
                  'display_name', au."display_name"
              ))
              FROM "Author_Article" aa
              JOIN "Author" au ON au."author_id" = aa."author_id"
              WHERE aa."article_id" = a."article_id"
                AND COALESCE(au."is_deleted", false) = false
          ),
          '[]'::json
      ) AS authors,
      j.display_name AS journal_name
    FROM MatchedArticles ma
    JOIN "Article" a ON a.article_id = ma.article_id
    LEFT JOIN "Keyword" k ON k.keyword_id = ma.keyword_id
    LEFT JOIN "Subject_Area" sa ON sa.subject_area_id = ma.subject_area_id
    LEFT JOIN "Issue" i ON i.issue_id = a.issue_id
    LEFT JOIN "Volume" v ON v.volume_id = i.volume_id
    LEFT JOIN "Journal" j ON j.journal_id = v.journal_id
    GROUP BY a.article_id, a.title, a.abstract, a.publication_year, a.doi, a.created_at, j.display_name
    ORDER BY a.publication_year DESC, a.created_at DESC
    LIMIT $2 OFFSET $3
  `;

  const [countResult, dataResult] = await Promise.all([
    pool.query(countQuery, [projectId]),
    pool.query(dataQuery, [projectId, limit, offset]),
  ]);

  const total = parseInt(countResult.rows[0]?.total) || 0;

  return {
    page,
    limit,
    total,
    total_pages: Math.ceil(total / limit),
    data: dataResult.rows.map((a) => ({
      article_id: a.article_id,
      title: a.title || null,
      abstract: a.abstract || null,
      publication_year: a.publication_year || null,
      doi: a.doi || null,
      matched_keywords: a.matched_keywords || [],
      matched_areas: a.matched_areas || [],
      authors: a.authors || [],
      journal_name: a.journal_name || null
    })),
  };
};

export const validateKeywordIds = async (keywordIds) => {
  if (!keywordIds || keywordIds.length === 0) return true;

  const uniqueIds = [...new Set(keywordIds)];

  const query = `
    SELECT keyword_id
    FROM "Keyword"
    WHERE keyword_id = ANY($1::bigint[])
  `;
  const result = await pool.query(query, [uniqueIds]);
  return result.rows.length === uniqueIds.length;
};

export const syncWatchedKeywords = async (projectId, keywordIds) => {
  if (!keywordIds || keywordIds.length === 0) return true;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const uniqueIds = [...new Set(keywordIds)];

    const existingResult = await client.query(
      `SELECT keyword_id FROM "Project_Keyword" WHERE project_id = $1`,
      [projectId],
    );
    const existingIds = new Set(
      existingResult.rows.map((row) => Number(row.keyword_id)),
    );

    const newKeywordIds = uniqueIds.filter((id) => !existingIds.has(id));

    if (newKeywordIds.length === 0) {
      await client.query("COMMIT");
      return true; 
    }

    const validationResult = await client.query(
      `SELECT keyword_id FROM "Keyword" WHERE keyword_id = ANY($1::bigint[])`,
      [newKeywordIds],
    );
    const validIds = new Set(
      validationResult.rows.map((row) => Number(row.keyword_id)),
    );

    const idsToInsert = newKeywordIds.filter((id) => validIds.has(id));

    if (idsToInsert.length > 0) {
      await client.query(
        `INSERT INTO "Project_Keyword" (project_id, keyword_id) 
         SELECT $1, unnest($2::bigint[])`,
        [projectId, idsToInsert]
      );
    }

    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

export const replaceWatchedKeywords = async (projectId, keywordIds) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `DELETE FROM "Project_Keyword" WHERE project_id = $1`,
      [projectId]
    );

    if (!keywordIds || keywordIds.length === 0) {
      await client.query('COMMIT');
      return true;
    }

    const uniqueIds = [...new Set(keywordIds)];

    const validationResult = await client.query(
      `SELECT keyword_id FROM "Keyword" WHERE keyword_id = ANY($1::bigint[])`,
      [uniqueIds]
    );
    const validIds = new Set(validationResult.rows.map(row => Number(row.keyword_id)));

    const idsToInsert = uniqueIds.filter(id => validIds.has(id));

    if (idsToInsert.length > 0) {
      await client.query(
        `INSERT INTO "Project_Keyword" (project_id, keyword_id) 
         SELECT $1, unnest($2::bigint[])`,
        [projectId, idsToInsert]
      );
    }

    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

export const addWatchedKeywords = async (projectId, keywordIds) => {
  if (!keywordIds || keywordIds.length === 0) return { success: true, insertedCount: 0 };

  const existingCheck = await pool.query(
    `SELECT keyword_id FROM "Project_Keyword" WHERE project_id = $1 AND keyword_id = ANY($2::int[])`,
    [projectId, keywordIds]
  );

  if (existingCheck.rows.length > 0) {
    const existingIds = existingCheck.rows.map(row => row.keyword_id);
    return { success: false, existingIds };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let insertedCount = 0;
    const result = await client.query(
      `INSERT INTO "Project_Keyword" (project_id, keyword_id) 
       SELECT $1, unnest($2::bigint[]) 
       ON CONFLICT DO NOTHING`,
      [projectId, keywordIds]
    );
    insertedCount = result.rowCount || 0;
    await client.query('COMMIT');
    return { success: true, insertedCount };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

export const checkProjectOwnership = async (projectId, userId) => {
  const result = await pool.query(
    `SELECT 1 FROM "Project" WHERE project_id = $1 AND user_id = $2`,
    [projectId, userId],
  );
  return result.rows.length > 0;
};

export const removeWatchedKeyword = async (projectId, keywordId) => {
  const result = await pool.query(
    `DELETE FROM "Project_Keyword" WHERE project_id = $1 AND keyword_id = $2 RETURNING *`,
    [projectId, keywordId]
  );

  return result.rowCount > 0;
};

export const addKeywordsToArticle = async (
  articleId,
  keywordsInput,
  options = {},
) => {
  const isEmptyObject =
    typeof keywordsInput === "object" &&
    !Array.isArray(keywordsInput) &&
    Object.keys(keywordsInput || {}).length === 0;
  if (
    !keywordsInput ||
    (Array.isArray(keywordsInput) && keywordsInput.length === 0) ||
    isEmptyObject
  ) {
    return [];
  }

  let keywordEntries = [];
  if (Array.isArray(keywordsInput)) {
    const score = options.score !== undefined ? Number(options.score) : 0.0;
    keywordEntries = keywordsInput
      .filter((name) => typeof name === "string")
      .map((name) => ({ display_name: name.trim(), score }))
      .filter((item) => item.display_name.length > 0);
  } else if (typeof keywordsInput === "object") {
    keywordEntries = Object.entries(keywordsInput)
      .filter(([name]) => typeof name === "string" && name.trim().length > 0)
      .map(([name, score]) => ({
        display_name: name.trim(),
        score: Number(score ?? 0),
      }));
  } else {
    throw new Error("Keywords must be an array or object");
  }

  if (keywordEntries.length === 0) {
    return [];
  }

  const uniqueKeywordNames = [
    ...new Set(keywordEntries.map((entry) => entry.display_name)),
  ];
  const scoreMap = Object.fromEntries(
    keywordEntries.map((entry) => [entry.display_name, entry.score]),
  );

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const upsertKeywordsQuery = `
            INSERT INTO "Keyword" (display_name)
            SELECT unnest($1::text[])
            ON CONFLICT (display_name)
            DO UPDATE SET display_name = EXCLUDED.display_name
            RETURNING keyword_id, display_name;
        `;

    const keywordResult = await client.query(upsertKeywordsQuery, [
      uniqueKeywordNames,
    ]);
    const allKeywords = keywordResult.rows;

    if (allKeywords.length === 0) {
      await client.query("COMMIT");
      return [];
    }

    const keywordIds = [];
    const keywordScores = [];
    for (const displayName of uniqueKeywordNames) {
      const keywordRow = allKeywords.find(
        (k) => k.display_name === displayName,
      );
      if (!keywordRow) continue;
      keywordIds.push(keywordRow.keyword_id);
      keywordScores.push(scoreMap[displayName] ?? 0.0);
    }

    if (keywordIds.length === 0) {
      await client.query("COMMIT");
      return [];
    }

    const insertRelationsQuery = `
            INSERT INTO "Keyword_Article" (article_id, keyword_id, score)
            SELECT $1, unnest($2::bigint[]), unnest($3::numeric[])
            ON CONFLICT DO NOTHING;
        `;

    await client.query(insertRelationsQuery, [
      articleId,
      keywordIds,
      keywordScores,
    ]);

    await client.query("COMMIT");
    return allKeywords;
  } catch (error) {
    await client.query("ROLLBACK");
    logger.error("Error adding keywords to article:", error);
    throw error;
  } finally {
    client.release();
  }
};

export const updateKeywordsToArticle = async (articleId, keywordsInput) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const deleteRelationsQuery = `
            DELETE FROM "Keyword_Article"
            WHERE "article_id" = $1;
        `;
    await client.query(deleteRelationsQuery, [articleId]);

    await client.query("COMMIT");

    const updatedKeywords = await addKeywordsToArticle(
      articleId,
      keywordsInput,
    );

    logger.info(
      `Đã làm mới toàn bộ danh sách từ khóa cho bài báo ID: ${articleId}`,
    );
    return updatedKeywords;
  } catch (error) {
    await client.query("ROLLBACK");
    logger.error(
      `Lỗi khi cập nhật danh sách từ khóa cho bài báo ID ${articleId}:`,
      error,
    );
    throw error;
  } finally {
    client.release();
  }
};

export const getKeywordById = async (id) => {
  const { rows } = await pool.query(
    `SELECT keyword_id, display_name FROM "Keyword"
     WHERE keyword_id = $1`,
    [id],
  );
  if (!rows.length) {
    const error = new Error("Keyword không tồn tại");
    error.statusCode = 404;
    error.code = "KEYWORD_NOT_FOUND";
    throw error;
  }
  return rows[0];
};

export const getAllKeywords = async ({ page = 1, limit = 10, search = "", subject_area_id }) => {
  const offset = (page - 1) * limit;
  const normalizedSearch = search.trim();
  const searchPattern = `%${normalizedSearch}%`;

  const parsedAreaId = subject_area_id ? parseInt(subject_area_id, 10) : null;

  if (parsedAreaId && !isNaN(parsedAreaId)) {
    const cacheKey = `keywords:area:${parsedAreaId}:${page}:${limit}:${normalizedSearch}`;
    const cachedData = await cacheService.get(cacheKey);
    if (cachedData) return cachedData;

    const countQuery = `
      SELECT COUNT(DISTINCT k.keyword_id) AS total
      FROM "Keyword" k
      JOIN "Keyword_Article" ka ON ka.keyword_id = k.keyword_id
      JOIN "Article" a ON a.article_id = ka.article_id AND COALESCE(a.is_deleted, false) = false
      JOIN "Issue" i ON i.issue_id = a.issue_id
      JOIN "Volume" v ON v.volume_id = i.volume_id
      JOIN "Journal_Subject_Category" jsc ON jsc.journal_id = v.journal_id
      JOIN "Subject_Category" sc ON sc.subject_category_id = jsc.subject_category_id
      WHERE sc.subject_area_id = $1
        AND ($2 = '' OR LOWER(k.display_name) LIKE LOWER($3))
    `;

    const dataQuery = `
      SELECT 
        k.keyword_id, 
        k.display_name,
        COUNT(ka.article_id) AS article_count
      FROM "Keyword" k
      JOIN "Keyword_Article" ka ON ka.keyword_id = k.keyword_id
      JOIN "Article" a ON a.article_id = ka.article_id AND COALESCE(a.is_deleted, false) = false
      JOIN "Issue" i ON i.issue_id = a.issue_id
      JOIN "Volume" v ON v.volume_id = i.volume_id
      JOIN "Journal_Subject_Category" jsc ON jsc.journal_id = v.journal_id
      JOIN "Subject_Category" sc ON sc.subject_category_id = jsc.subject_category_id
      WHERE sc.subject_area_id = $1
        AND ($2 = '' OR LOWER(k.display_name) LIKE LOWER($3))
      GROUP BY k.keyword_id, k.display_name
      ORDER BY article_count DESC, k.display_name ASC
      LIMIT $4 OFFSET $5
    `;

    const [countResult, dataResult] = await Promise.all([
      pool.query(countQuery, [parsedAreaId, normalizedSearch, searchPattern]),
      pool.query(dataQuery, [parsedAreaId, normalizedSearch, searchPattern, limit, offset]),
    ]);

    const total = parseInt(countResult.rows[0]?.total || 0, 10);
    const result = {
      data: dataResult.rows,
      pagination: { page, limit, total, total_pages: Math.max(1, Math.ceil(total / limit)) },
    };

    await cacheService.set(cacheKey, result, 300);
    return result;
  }

  const countQuery = `
    SELECT COUNT(*) AS total FROM "Keyword"
    WHERE ($1 = '' OR LOWER(display_name) LIKE LOWER($2))
  `;
  const dataQuery = `
    SELECT keyword_id, display_name FROM "Keyword"
    WHERE ($1 = '' OR LOWER(display_name) LIKE LOWER($2))
    ORDER BY display_name ASC
    LIMIT $3 OFFSET $4
  `;

  const cacheKey = `keywords:all:${page}:${limit}:${normalizedSearch}`;
  const cachedData = await cacheService.get(cacheKey);
  if (cachedData) return cachedData;

  const [countResult, dataResult] = await Promise.all([
    pool.query(countQuery, [normalizedSearch, searchPattern]),
    pool.query(dataQuery, [normalizedSearch, searchPattern, limit, offset]),
  ]);

  const total = parseInt(countResult.rows[0].total);
  const result = {
    data: dataResult.rows,
    pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
  };

  await cacheService.set(cacheKey, result, 300);
  return result;
};

export const getArticlesByKeyword = async (keywordId, { page = 1, limit = 10, sortBy = 'publication_year', sortOrder = 'desc' } = {}) => {
  const offset = (page - 1) * limit;

  const allowedSortFields = ['publication_year', 'title', 'created_at'];
  const safeSort = allowedSortFields.includes(sortBy) ? sortBy : 'publication_year';
  const safeOrder = sortOrder === 'asc' ? 'ASC' : 'DESC';

  const countQuery = `
    SELECT COUNT(DISTINCT a.article_id) AS total
    FROM "Article" a
    JOIN "Keyword_Article" ka ON ka.article_id = a.article_id
    WHERE ka.keyword_id = $1
  `;

  const dataQuery = `
    SELECT
      a.article_id,
      a.title,
      a.abstract,
      a.publication_year,
      a.doi,
      j.display_name AS journal_name,
      0 AS citations_count
    FROM "Article" a
    JOIN "Keyword_Article" ka ON ka.article_id = a.article_id
    LEFT JOIN "Issue" i   ON i.issue_id   = a.issue_id
    LEFT JOIN "Volume" v  ON v.volume_id  = i.volume_id
    LEFT JOIN "Journal" j ON j.journal_id = v.journal_id
    WHERE ka.keyword_id = $1
    ORDER BY a.${safeSort} ${safeOrder} NULLS LAST
    LIMIT $2 OFFSET $3
  `;

  const cacheKey = `keywords:articles:${keywordId}:${page}:${limit}:${safeSort}:${safeOrder}`;
  const cachedData = await cacheService.get(cacheKey);
  if (cachedData) return cachedData;

  const [countResult, dataResult] = await Promise.all([
    pool.query(countQuery, [keywordId]),
    pool.query(dataQuery, [keywordId, limit, offset]),
  ]);

  const total = parseInt(countResult.rows[0].total);
  const result = {
    data: dataResult.rows,
    pagination: { page, limit, total, total_pages: Math.max(1, Math.ceil(total / limit)) },
  };

  await cacheService.set(cacheKey, result, 300);
  return result;
};

export const createKeyword = async (display_name) => {
  const duplicateCheck = await pool.query(
    `SELECT keyword_id, is_deleted FROM "Keyword"
     WHERE LOWER(display_name) = LOWER($1)`,
    [display_name],
  );

  if (duplicateCheck.rows.length > 0) {
    if (duplicateCheck.rows[0].is_deleted) {
      const error = new Error(
        "Keyword này đã bị xóa trước đó, vui lòng sử dụng API Restore để khôi phục",
      );
      error.statusCode = 409;
      error.code = "KEYWORD_ALREADY_DELETED";
      throw error;
    }
    const error = new Error("Keyword đã tồn tại");
    error.statusCode = 409;
    error.code = "KEYWORD_DUPLICATE";
    throw error;
  }

  const { rows } = await pool.query(
    `INSERT INTO "Keyword" (display_name)
     VALUES ($1) RETURNING keyword_id, display_name`,
    [display_name],
  );
  return rows[0];
};

export const updateKeyword = async (id, display_name) => {
  const existing = await pool.query(
    `SELECT keyword_id FROM "Keyword"
     WHERE keyword_id = $1 AND is_deleted = false`,
    [id],
  );
  if (!existing.rows.length) {
    const error = new Error("Keyword không tồn tại");
    error.statusCode = 404;
    error.code = "KEYWORD_NOT_FOUND";
    throw error;
  }

  const duplicateCheck = await pool.query(
    `SELECT keyword_id FROM "Keyword"
     WHERE LOWER(display_name) = LOWER($1)
     AND keyword_id != $2 AND is_deleted = false`,
    [display_name, id],
  );
  if (duplicateCheck.rows.length > 0) {
    const error = new Error("Keyword đã tồn tại");
    error.statusCode = 409;
    error.code = "KEYWORD_DUPLICATE";
    throw error;
  }

  const { rows } = await pool.query(
    `UPDATE "Keyword" SET display_name = $1
     WHERE keyword_id = $2
     RETURNING keyword_id, display_name`,
    [display_name, id],
  );
  return rows[0];
};

export const deleteKeyword = async (id) => {
  const existing = await pool.query(
    `SELECT keyword_id, is_deleted FROM "Keyword"
     WHERE keyword_id = $1`,
    [id],
  );
  if (!existing.rows.length) {
    const error = new Error("Keyword không tồn tại");
    error.statusCode = 404;
    error.code = "KEYWORD_NOT_FOUND";
    throw error;
  }
  if (existing.rows[0].is_deleted) {
    const error = new Error("Keyword đã bị xóa trước đó");
    error.statusCode = 400;
    error.code = "KEYWORD_ALREADY_DELETED";
    throw error;
  }

  const { rows } = await pool.query(
    `UPDATE "Keyword" SET is_deleted = true
     WHERE keyword_id = $1
     RETURNING keyword_id, display_name, is_deleted`,
    [id],
  );
  return rows[0];
};

export const restoreKeyword = async (id) => {
  const existing = await pool.query(
    `SELECT keyword_id, is_deleted FROM "Keyword"
     WHERE keyword_id = $1`,
    [id],
  );
  if (!existing.rows.length) {
    const error = new Error("Keyword không tồn tại");
    error.statusCode = 404;
    error.code = "KEYWORD_NOT_FOUND";
    throw error;
  }
  if (!existing.rows[0].is_deleted) {
    const error = new Error("Keyword này đang active, không cần restore");
    error.statusCode = 400;
    error.code = "KEYWORD_ALREADY_ACTIVE";
    throw error;
  }

  const { rows } = await pool.query(
    `UPDATE "Keyword" SET is_deleted = false
     WHERE keyword_id = $1
     RETURNING keyword_id, display_name, is_deleted`,
    [id],
  );
  return rows[0];
};
