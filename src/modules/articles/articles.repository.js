import pool from '../../config/database.js';
import logger from '../../utils/logger.js';
import cacheService from '../../services/cache.service.js';
import crypto from 'crypto';

const ARTICLE_CACHE_TTL = parseInt(process.env.ARTICLE_CACHE_TTL, 10) || 900;

/**
 * Tìm các bài báo có chứa các keyword người dùng nhập vào trên toàn hệ thống
 * Luồng JOIN trong DB: Article → Keyword_Article → Keyword
 * @param {string[]} keywords - Mảng tên keyword (ví dụ: ["Machine Learning", "Deep Learning"])
 * @param {number} [limit=20] - Số bài tối đa trả về
 * @param {number} [offset=0] - Vị trí bắt đầu (dùng cho phân trang)
 * @returns {Promise<Array<Object>>} Danh sách bài báo kèm keyword matched
 */
export const getArticlesByKeywords = async (keywords, limit = 20, offset = 0) => {
    const keywordPlaceholders = keywords
        .map((_, index) => `$${index + 3}`)
        .join(', ');

    const values = [limit, offset, ...keywords];

    const query = `
        SELECT DISTINCT
            a."article_id",
            a."title",
            a."abstract",
            a."publication_year",
            a."doi",
            a."created_at"
        FROM "Article" a
        JOIN "Keyword_Article" ka ON ka."article_id" = a."article_id"
        JOIN "Keyword" k         ON k."keyword_id"   = ka."keyword_id"
        WHERE LOWER(k."display_name") IN (${keywordPlaceholders})
          AND a."is_deleted" = false
        ORDER BY a."publication_year" DESC NULLS LAST, a."created_at" DESC
        LIMIT $1 OFFSET $2
    `;

    const cacheKey = `article:list:keywords:${crypto.createHash('md5').update(JSON.stringify({ keywords, limit, offset })).digest('hex')}`;
    const cachedData = await cacheService.get(cacheKey);
    if (cachedData) return cachedData;

    const result = await pool.query(query, values);
    await cacheService.set(cacheKey, result.rows, ARTICLE_CACHE_TTL);
    return result.rows;
};

/**
 * Đếm số bài báo khớp với danh sách từ khóa (case-insensitive).
 *
 * @param {string[]} keywords - Mảng tên keyword (sẽ được so sánh bằng LOWER)
 * @returns {Promise<number>} Tổng số bài báo khớp
 */
export const countArticlesByKeywords = async (keywords) => {
    const keywordPlaceholders = keywords
        .map((_, index) => `$${index + 1}`)
        .join(', ');

    const values = [...keywords];

    const query = `
        SELECT COUNT(DISTINCT a."article_id") AS "total"
        FROM "Article" a
        JOIN "Keyword_Article" ka ON ka."article_id" = a."article_id"
        JOIN "Keyword" k         ON k."keyword_id"   = ka."keyword_id"
        WHERE LOWER(k."display_name") IN (${keywordPlaceholders})
          AND a."is_deleted" = false
    `;

    const cacheKey = `article:count:keywords:${crypto.createHash('md5').update(JSON.stringify(keywords)).digest('hex')}`;
    const cachedData = await cacheService.get(cacheKey);
    if (cachedData !== null && cachedData !== undefined) return parseInt(cachedData, 10);

    const result = await pool.query(query, values);
    const total = parseInt(result.rows[0].total, 10);
    await cacheService.set(cacheKey, total, ARTICLE_CACHE_TTL);
    return total;
};

const toOptionalNumber = (value) => {
    if (value === undefined || value === null || value === '') return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
};

/**
 * Đếm tổng số bài báo công khai theo cùng bộ lọc với trang Article List.
 * 
 * @param {Object} [params={}] - Cấu hình bộ lọc
 * @param {string} [params.search] - Từ khóa tìm kiếm (title, doi, abstract)
 * @param {string|number} [params.publicationYear] - Lọc theo năm xuất bản
 * @param {string|number} [params.journalId] - Lọc theo ID của Journal
 * @param {string|number} [params.topicId] - Lọc theo Topic ID
 * @param {string|number} [params.volumeId] - Lọc theo Volume ID
 * @param {string|number} [params.issueId] - Lọc theo Issue ID
 * @param {boolean|string} [params.isOpenAccess] - Lọc theo trạng thái Open Access
 * @param {string|number} [params.countryId] - Lọc theo ID Quốc gia của Journal
 * @returns {Promise<number>} Tổng số bài báo thoả mãn bộ lọc
 */
export const countAllArticles = async ({
    search = '',
    publicationYear,
    journalId,
    topicId,
    volumeId,
    issueId,
    isOpenAccess,
    countryId,
} = {}) => {
    if (!search && !publicationYear && !journalId && !topicId && !volumeId && !issueId && isOpenAccess === undefined && !countryId) {
        const stats = await getArticleListStats();
        return stats.totalArticles;
    }

    const cacheKey = `article:count:${crypto.createHash('md5').update(JSON.stringify({
        search, publicationYear, journalId, topicId, volumeId, issueId, isOpenAccess, countryId
    })).digest('hex')}`;
    const cachedData = await cacheService.get(cacheKey);
    if (cachedData !== null && cachedData !== undefined) return parseInt(cachedData, 10);

    const values = [];
    const where = ['a."is_deleted" = false'];

    let needsIssue = false;
    let needsVolume = false;
    let needsJournal = false;

    if (search && search.trim()) {
        values.push(`%${search.trim()}%`);
        where.push(`(a."title" ILIKE $${values.length} OR a."doi" ILIKE $${values.length})`);
    }

    const publicationYearNum = toOptionalNumber(publicationYear);
    if (publicationYearNum !== undefined) {
        values.push(publicationYearNum);
        where.push(`a."publication_year" = $${values.length}`);
    }

    const journalIdNum = toOptionalNumber(journalId);
    if (journalIdNum !== undefined) {
        needsJournal = true;
        values.push(journalIdNum);
        where.push(`j."journal_id" = $${values.length}`);
    }

    const topicIdNum = toOptionalNumber(topicId);
    if (topicIdNum !== undefined) {
        values.push(topicIdNum);
        where.push(`a."primary_topic" = $${values.length}`);
    }

    const volumeIdNum = toOptionalNumber(volumeId);
    if (volumeIdNum !== undefined) {
        needsVolume = true;
        values.push(volumeIdNum);
        where.push(`v."volume_id" = $${values.length}`);
    }

    const issueIdNum = toOptionalNumber(issueId);
    if (issueIdNum !== undefined) {
        needsIssue = true;
        values.push(issueIdNum);
        where.push(`a."issue_id" = $${values.length}`);
    }

    if (isOpenAccess !== undefined) {
        needsJournal = true;
        values.push(isOpenAccess === true || isOpenAccess === 'true');
        where.push(`(j."is_open_access" = $${values.length})`);
    }

    if (countryId) {
        needsJournal = true;
        values.push(Number(countryId));
        where.push(`j."country" = $${values.length}`);
    }

    if (needsJournal) needsVolume = true;
    if (needsVolume) needsIssue = true;

    const joins = [];
    if (needsIssue) joins.push(`LEFT JOIN "Issue" i ON i."issue_id" = a."issue_id" AND (i."is_deleted" = false OR i."is_deleted" IS NULL)`);
    if (needsVolume) joins.push(`LEFT JOIN "Volume" v ON v."volume_id" = i."volume_id" AND (v."is_deleted" = false OR v."is_deleted" IS NULL)`);
    if (needsJournal) joins.push(`LEFT JOIN "Journal" j ON j."journal_id" = v."journal_id" AND (j."is_deleted" = false OR j."is_deleted" IS NULL)`);

    let query = `
        SELECT COUNT(*) AS "total"
        FROM "Article" a
        ${joins.join('\n        ')}
        WHERE ${where.join(' AND ')}
    `;

    const result = await pool.query(query, values);
    const total = parseInt(result.rows[0].total, 10);
    await cacheService.set(cacheKey, total, ARTICLE_CACHE_TTL);
    return total;
};

/**
 * Đếm tổng số bài báo chưa bị xóa trong hệ thống.
 *
 * @returns {Promise<number>} Tổng số bài báo
 */
export const getTotalArticles = async () => {
    try {
        const query = `SELECT COUNT(*) AS total FROM "Article" WHERE "is_deleted" = false;`;
        const result = await pool.query(query);
        return parseInt(result.rows[0].total, 10);
    } catch (error) {
        logger.error('Lỗi khi đếm tổng số bài báo:', error);
        throw error;
    }
};

/**
 * Lấy các thông số thống kê tổng quan của danh sách bài báo.
 * Dữ liệu trả về bao gồm tổng số bài báo, số lượng bài open access, số lượng tác giả, và số topic.
 *
 * @returns {Promise<{totalArticles: number, openAccessCount: number, authorsCount: number, topicsCount: number}>} Đối tượng chứa các thống kê
 */
export const getArticleListStats = async () => {
    try {
        const cacheKey = `article:stats:all`;
        const cachedData = await cacheService.get(cacheKey);
        if (cachedData) return cachedData;

        const totalArticlesPromise = pool.query(`SELECT COUNT(*) AS total FROM "Article" WHERE "is_deleted" = false;`);

        const openAccessCountPromise = pool.query(`
            SELECT COUNT(a."article_id") AS total
            FROM "Article" a
            JOIN "Issue" i ON i."issue_id" = a."issue_id" AND (i."is_deleted" = false OR i."is_deleted" IS NULL)
            JOIN "Volume" v ON v."volume_id" = i."volume_id" AND (v."is_deleted" = false OR v."is_deleted" IS NULL)
            JOIN "Journal" j ON j."journal_id" = v."journal_id" AND (j."is_deleted" = false OR j."is_deleted" IS NULL)
            WHERE a."is_deleted" = false AND j."is_open_access" = true;
        `);

        const authorsCountPromise = pool.query(`SELECT COUNT(DISTINCT "author_id") AS total FROM "Author_Article";`);

        const topicsCountPromise = pool.query(`SELECT COUNT(DISTINCT "primary_topic") AS total FROM "Article" WHERE "is_deleted" = false AND "primary_topic" IS NOT NULL;`);

        const [totalRes, openAccessRes, authorsRes, topicsRes] = await Promise.all([
            totalArticlesPromise,
            openAccessCountPromise,
            authorsCountPromise,
            topicsCountPromise
        ]);

        const stats = {
            totalArticles: parseInt(totalRes.rows[0]?.total || 0, 10),
            openAccessCount: parseInt(openAccessRes.rows[0]?.total || 0, 10),
            authorsCount: parseInt(authorsRes.rows[0]?.total || 0, 10),
            topicsCount: parseInt(topicsRes.rows[0]?.total || 0, 10),
        };

        await cacheService.set(cacheKey, stats, ARTICLE_CACHE_TTL);
        return stats;
    } catch (error) {
        logger.error('Lỗi khi lấy thống kê bài báo:', error);
        throw error;
    }
};

/**
 * Lấy danh sách metadata cho bộ lọc bài báo: các năm có trong DB, top journals và top topics.
 */
export const getArticleFilterMetadata = async () => {
    try {
        const cacheKey = 'article:filter:metadata';
        const cachedData = await cacheService.get(cacheKey);
        if (cachedData) return cachedData;

        const yearsPromise = pool.query(`
            SELECT DISTINCT a."publication_year" AS year
            FROM "Article" a
            WHERE a."is_deleted" = false AND a."publication_year" IS NOT NULL
            ORDER BY a."publication_year" DESC;
        `);

        const topJournalsPromise = pool.query(`
            SELECT 
                j."journal_id"::text AS journal_id, 
                j."display_name", 
                COUNT(a."article_id") AS article_count
            FROM "Article" a
            JOIN "Issue" i ON i."issue_id" = a."issue_id" AND (i."is_deleted" = false OR i."is_deleted" IS NULL)
            JOIN "Volume" v ON v."volume_id" = i."volume_id" AND (v."is_deleted" = false OR v."is_deleted" IS NULL)
            JOIN "Journal" j ON j."journal_id" = v."journal_id" AND (j."is_deleted" = false OR j."is_deleted" IS NULL)
            WHERE a."is_deleted" = false
            GROUP BY j."journal_id", j."display_name"
            ORDER BY article_count DESC
            LIMIT 50;
        `);

        const topTopicsPromise = pool.query(`
            SELECT 
                t."topic_id"::text AS topic_id, 
                t."display_name", 
                COUNT(a."article_id") AS article_count
            FROM "Article" a
            JOIN "Topic" t ON t."topic_id" = a."primary_topic" AND (t."is_deleted" = false OR t."is_deleted" IS NULL)
            WHERE a."is_deleted" = false
            GROUP BY t."topic_id", t."display_name"
            ORDER BY article_count DESC
            LIMIT 50;
        `);

        const [yearsRes, journalsRes, topicsRes] = await Promise.all([
            yearsPromise,
            topJournalsPromise,
            topTopicsPromise
        ]);

        const data = {
            years: yearsRes.rows.map((r) => r.year),
            journals: journalsRes.rows.map((r) => ({
                journal_id: r.journal_id,
                display_name: r.display_name,
                article_count: parseInt(r.article_count, 10),
            })),
            topics: topicsRes.rows.map((r) => ({
                topic_id: r.topic_id,
                display_name: r.display_name,
                article_count: parseInt(r.article_count, 10),
            })),
        };

        await cacheService.set(cacheKey, data, 3600);
        return data;
    } catch (error) {
        logger.error('Lỗi khi lấy article filter metadata:', error);
        throw error;
    }
};

/**
 * Lấy danh sách bài báo công khai cho Article List Page.
 * Hỗ trợ search, filter, sort và JOIN metadata từ Issue → Volume → Journal → Topic.
 *
 * @param {Object|number} [firstParam={}] - Object chứa các bộ lọc hoặc `limit` (hỗ trợ legacy)
 * @param {number} [firstParam.limit=10] - Số lượng bài báo mỗi trang
 * @param {number} [firstParam.offset=0] - Vị trí bắt đầu phân trang
 * @param {string} [firstParam.search=''] - Từ khóa tìm kiếm
 * @param {string} [firstParam.sortBy='created_at'] - Trường dùng để sắp xếp
 * @param {string} [firstParam.sortOrder='DESC'] - Chiều sắp xếp (ASC/DESC)
 * @param {string|number} [firstParam.publicationYear] - Năm xuất bản
 * @param {string|number} [firstParam.journalId] - ID của tạp chí
 * @param {string|number} [firstParam.topicId] - ID của Topic
 * @param {string|number} [firstParam.volumeId] - ID của Volume
 * @param {string|number} [firstParam.issueId] - ID của Issue
 * @param {boolean|string} [firstParam.isOpenAccess] - Chỉ lấy bài báo Open Access
 * @param {string|number} [firstParam.countryId] - ID của quốc gia xuất bản
 * @param {number} [offsetParam=0] - Vị trí bắt đầu (legacy)
 * @param {string} [sortByParam='created_at'] - Trường sắp xếp (legacy)
 * @param {string} [sortOrderParam='DESC'] - Chiều sắp xếp (legacy)
 * @returns {Promise<Array<Object>>} Mảng bài báo đã enrich metadata
 */
export const getAllArticles = async (firstParam = {}, offsetParam = 0, sortByParam = 'created_at', sortOrderParam = 'DESC') => {
    try {
        const params = typeof firstParam === 'object' && firstParam !== null
            ? firstParam
            : {
                limit: firstParam !== undefined ? firstParam : 20,
                offset: offsetParam,
                sortBy: sortByParam,
                sortOrder: sortOrderParam,
            };

        const {
            limit = 10,
            offset = 0,
            search = '',
            sortBy = 'created_at',
            sortOrder = 'DESC',
            publicationYear,
            journalId,
            topicId,
            volumeId,
            issueId,
            isOpenAccess,
            countryId,
        } = params;

        const allowedColumns = {
            article_id: 'a."article_id"',
            title: 'a."title"',
            publication_year: 'a."publication_year"',
            created_at: 'a."created_at"',
            doi: 'a."doi"',
        };
        const column = allowedColumns[sortBy] || allowedColumns.created_at;
        const order = ['ASC', 'DESC'].includes(String(sortOrder).toUpperCase())
            ? String(sortOrder).toUpperCase()
            : 'DESC';

        const cacheKey = `article:list:${crypto.createHash('md5').update(JSON.stringify(params)).digest('hex')}`;
        const cachedData = await cacheService.get(cacheKey);
        if (cachedData) return cachedData;

        const values = [];
        const where = ['a."is_deleted" = false'];

        let needsIssue = false;
        let needsVolume = false;
        let needsJournal = false;

        if (search && search.trim()) {
            values.push(`%${search.trim()}%`);
            where.push(`(a."title" ILIKE $${values.length} OR a."doi" ILIKE $${values.length})`);
        }

        const publicationYearNum = toOptionalNumber(publicationYear);
        if (publicationYearNum !== undefined) {
            values.push(publicationYearNum);
            where.push(`a."publication_year" = $${values.length}`);
        }

        const journalIdNum = toOptionalNumber(journalId);
        if (journalIdNum !== undefined) {
            needsJournal = true;
            values.push(journalIdNum);
            where.push(`j."journal_id" = $${values.length}`);
        }

        const topicIdNum = toOptionalNumber(topicId);
        if (topicIdNum !== undefined) {
            values.push(topicIdNum);
            where.push(`a."primary_topic" = $${values.length}`);
        }

        const volumeIdNum = toOptionalNumber(volumeId);
        if (volumeIdNum !== undefined) {
            needsVolume = true;
            values.push(volumeIdNum);
            where.push(`v."volume_id" = $${values.length}`);
        }

        const issueIdNum = toOptionalNumber(issueId);
        if (issueIdNum !== undefined) {
            needsIssue = true;
            values.push(issueIdNum);
            where.push(`a."issue_id" = $${values.length}`);
        }

        if (isOpenAccess !== undefined) {
            needsJournal = true;
            values.push(isOpenAccess === true || isOpenAccess === 'true');
            where.push(`(j."is_open_access" = $${values.length})`);
        }

        if (countryId) {
            needsJournal = true;
            values.push(Number(countryId));
            where.push(`j."country" = $${values.length}`);
        }

        values.push(Number(limit));
        const limitIndex = values.length;
        values.push(toOptionalNumber(offset) ?? 0);
        const offsetIndex = values.length;

        if (needsJournal) needsVolume = true;
        if (needsVolume) needsIssue = true;

        const innerJoins = [];
        if (needsIssue) innerJoins.push(`LEFT JOIN "Issue" i ON i."issue_id" = a."issue_id" AND (i."is_deleted" = false OR i."is_deleted" IS NULL)`);
        if (needsVolume) innerJoins.push(`LEFT JOIN "Volume" v ON v."volume_id" = i."volume_id" AND (v."is_deleted" = false OR v."is_deleted" IS NULL)`);
        if (needsJournal) innerJoins.push(`LEFT JOIN "Journal" j ON j."journal_id" = v."journal_id" AND (j."is_deleted" = false OR j."is_deleted" IS NULL)`);

        const nullsClause = sortBy === 'publication_year' && order === 'DESC' ? ' NULLS LAST' : '';
        const innerOrderBy = `${column} ${order}${nullsClause}, a."article_id" DESC`;
        const outerOrderBy = `${column.replace('a.', 'ap.')} ${order}${nullsClause}, ap."article_id" DESC`;

        const query = `
            WITH article_page AS (
                SELECT 
                    a."article_id",
                    a."version",
                    a."issue_id",
                    a."title",
                    a."abstract",
                    a."publication_year",
                    a."doi",
                    a."primary_topic",
                    a."created_at"
                FROM "Article" a
                ${innerJoins.join('\n                ')}
                WHERE ${where.join(' AND ')}
                ORDER BY ${innerOrderBy}
                LIMIT $${limitIndex} OFFSET $${offsetIndex}
            ),
            author_json AS (
                SELECT
                    aa."article_id",
                    json_agg(
                        json_build_object(
                            'author_id', au."author_id"::text,
                            'display_name', au."display_name"
                        )
                    ) AS authors
                FROM "Author_Article" aa
                JOIN "Author" au
                    ON au."author_id" = aa."author_id"
                   AND (au."is_deleted" = false OR au."is_deleted" IS NULL)
                WHERE aa."article_id" IN (
                    SELECT "article_id" FROM article_page
                )
                GROUP BY aa."article_id"
            )
            SELECT
                ap."article_id"::text,
                ap."version",
                ap."issue_id"::text,
                ap."title",
                ap."abstract",
                ap."publication_year",
                ap."doi",
                ap."primary_topic"::text,
                t."display_name" AS "topic_name",
                ap."created_at",
                j."journal_id"::text,
                j."display_name" AS "journal_name",
                j."issn" AS "journal_issn",
                COALESCE(j."is_open_access", false) AS "is_open_access",
                COALESCE(aj.authors, '[]'::json) AS "authors"
            FROM article_page ap
            LEFT JOIN "Issue" i   ON i."issue_id"   = ap."issue_id" AND (i."is_deleted" = false OR i."is_deleted" IS NULL)
            LEFT JOIN "Volume" v  ON v."volume_id"  = i."volume_id" AND (v."is_deleted" = false OR v."is_deleted" IS NULL)
            LEFT JOIN "Journal" j ON j."journal_id" = v."journal_id" AND (j."is_deleted" = false OR j."is_deleted" IS NULL)
            LEFT JOIN "Topic" t ON t."topic_id" = ap."primary_topic"
            LEFT JOIN author_json aj ON aj."article_id" = ap."article_id"
            ORDER BY ${outerOrderBy};
        `;

        const result = await pool.query(query, values);
        await cacheService.set(cacheKey, result.rows, ARTICLE_CACHE_TTL);
        return result.rows;

    } catch (error) {
        logger.error('Lỗi khi lấy tất cả bài báo (getAllArticles Service):', error);
        throw error;
    }
};

/**
 * Lấy thông tin chi tiết một bài báo theo `article_id`.
 * Lưu ý: Trả về cả bài báo đã bị xóa mềm (is_deleted = true).
 *
 * @param {number|string} articleId - ID bài báo
 * @returns {Promise<Object|null>} Bản ghi bài báo hoặc `null` nếu không tồn tại
 */
export const getArticleById = async (articleId) => {
    try {
        const cacheKey = `article:detail:${articleId}`;
        const cachedData = await cacheService.get(cacheKey);
        if (cachedData) return cachedData;

        const detailQuery = `
            SELECT 
                a."article_id"::text AS "article_id",
                a."version",
                a."issue_id"::text AS "issue_id",
                a."title",
                a."abstract",
                a."publication_year",
                a."doi",
                a."primary_topic"::text AS "primary_topic",
                pt."display_name" AS "topic_name",
                a."is_deleted",
                a."created_at",
                i."issue_number" AS "issue_number",
                v."volume_id"::text AS "volume_id",
                v."volume_number" AS "volume_number",
                j."journal_id"::text AS "journal_id",
                j."display_name" AS "journal_name",
                j."issn" AS "journal_issn",
                p."publisher_id"::text AS "publisher_id",
                p."display_name" AS "publisher_name",
                a."citation_count" AS "cited_by_count",
                a."references",
                a."reference_count",
                COALESCE(j."is_open_access", false) AS "is_open_access",
                CASE
                    WHEN a."doi" IS NULL OR TRIM(a."doi") = '' THEN NULL
                    WHEN a."doi" ILIKE 'http%' THEN a."doi"
                    ELSE CONCAT('https://doi.org/', a."doi")
                END AS "source_url"
            FROM "Article" a
            LEFT JOIN "Issue" i   ON i."issue_id" = a."issue_id"
            LEFT JOIN "Volume" v  ON v."volume_id" = i."volume_id"
            LEFT JOIN "Journal" j ON j."journal_id" = v."journal_id"
            LEFT JOIN "Publisher" p ON p."publisher_id" = j."publisher_id"
            LEFT JOIN "Topic" pt  ON pt."topic_id" = a."primary_topic"
            WHERE a."article_id" = $1;
        `;

        const detailResult = await pool.query(detailQuery, [articleId]);
        const article = detailResult.rows[0] || null;

        if (!article) {
            return null;
        }

        const authorsQuery = `
            SELECT 
                au."author_id"::text AS "author_id",
                au."display_name",
                au."orcid",
                au."url_image",
                au."last_known_institution",
                au."works_count"
            FROM "Author_Article" aa
            JOIN "Author" au ON au."author_id" = aa."author_id"
            WHERE aa."article_id" = $1
              AND COALESCE(au."is_deleted", false) = false
            ORDER BY au."display_name" ASC;
        `;

        const keywordsQuery = `
            SELECT 
                k."keyword_id"::text AS "keyword_id",
                k."display_name",
                ka."score"
            FROM "Keyword_Article" ka
            JOIN "Keyword" k ON k."keyword_id" = ka."keyword_id"
            WHERE ka."article_id" = $1
            ORDER BY COALESCE(ka."score", 0) DESC, k."display_name" ASC;
        `;

        const topicsQuery = `
            SELECT 
                t."topic_id"::text AS "topic_id",
                t."display_name",
                (t."topic_id" = a."primary_topic") AS "is_primary"
            FROM "Article" a
            JOIN (
                SELECT "article_id", "topic_id" FROM "Sub_Topic"
                UNION
                SELECT "article_id", "primary_topic" AS "topic_id"
                FROM "Article"
                WHERE "primary_topic" IS NOT NULL
            ) at ON at."article_id" = a."article_id"
            JOIN "Topic" t ON t."topic_id" = at."topic_id"
            WHERE a."article_id" = $1
              AND COALESCE(t."is_deleted", false) = false
            ORDER BY "is_primary" DESC, t."display_name" ASC;
        `;

        const [authorsResult, keywordsResult, topicsResult] = await Promise.all([
            pool.query(authorsQuery, [articleId]),
            pool.query(keywordsQuery, [articleId]),
            pool.query(topicsQuery, [articleId])
        ]);

        const finalResult = {
            ...article,
            authors: authorsResult.rows,
            keywords: keywordsResult.rows,
            topics: topicsResult.rows,
        };

        await cacheService.set(cacheKey, finalResult, ARTICLE_CACHE_TTL);
        return finalResult;
    } catch (error) {
        logger.error('Lỗi khi lấy thông tin bài báo theo ID:', error);
        throw error;
    }
};

/**
 * Tạo mới một bản ghi bài báo (dữ liệu thô) và trả về record vừa tạo.
 *
 * @param {Object} articleData - Dữ liệu bài báo
 * @param {string} articleData.title - Tiêu đề (bắt buộc)
 * @param {number} articleData.publication_year - Năm xuất bản (bắt buộc)
 * @param {number} [articleData.issue_id]
 * @param {string} [articleData.abstract]
 * @param {string} [articleData.doi]
 * @param {number|null} [articleData.primary_topic]
 * @returns {Promise<Object>} Bản ghi bài báo vừa tạo
 */
export const createArticle = async (articleData) => {
    try {
        const {
            version = null,
            issue_id = null,
            title,
            abstract = null,
            publication_year,
            doi = null,
            primary_topic = null
        } = articleData;

        if (!title || publication_year === undefined) {
            throw new Error('Title and publication_year are required fields.');
        }

        let finalTopicId = primary_topic;
        if (primary_topic) {
            // Check if it's already a valid topic_id
            const checkTopic = await pool.query(`SELECT topic_id FROM "Topic" WHERE topic_id = $1`, [primary_topic]);
            if (checkTopic.rows.length === 0) {
                // Not a valid topic_id, assume it's a category_id. Pick the first topic in this category.
                const catTopic = await pool.query(
                    `SELECT topic_id FROM "Topic" WHERE subject_category_id = $1 LIMIT 1`,
                    [primary_topic.toString()]
                );
                if (catTopic.rows.length > 0) {
                    finalTopicId = catTopic.rows[0].topic_id;
                } else {
                    // Fallback to the first available topic in the database
                    const firstTopic = await pool.query(`SELECT topic_id FROM "Topic" LIMIT 1`);
                    if (firstTopic.rows.length > 0) {
                        finalTopicId = firstTopic.rows[0].topic_id;
                    } else {
                        finalTopicId = null;
                    }
                }
            }
        }

        const query = `
            INSERT INTO "Article" (
                version, 
                issue_id, 
                title, 
                abstract, 
                publication_year, 
                doi, 
                primary_topic
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *;
        `;

        const values = [
            version,
            issue_id,
            title,
            abstract,
            publication_year,
            doi,
            finalTopicId
        ];

        const result = await pool.query(query, values);

        await cacheService.delByPattern('article:list:*');
        await cacheService.delByPattern('article:count:*');
        await cacheService.del('article:stats:all');

        const createdArticle = result.rows[0];
        return createdArticle;
    } catch (error) {
        logger.error('Error creating article:', error);
        throw error;
    }
};

/**
 * Cập nhật thông tin cốt lõi của bài báo (Tầng Service)
 * @param {Object} params 
 * @param {number|string} params.article_id - ID bài báo cần update (Bắt buộc)
 * @param {Object} params.updateData - Object chứa các trường muốn thay đổi từ req.body
 * @returns {Promise<Object|null>} Bản ghi sau khi update thành công
 */
export const updateArticle = async ({ article_id, ...updateData }) => {
    try {
        if (!article_id) {
            throw new Error('Thiếu article_id khi gọi hàm updateArticle Service.');
        }

        const currentQuery = `SELECT * FROM "Article" WHERE "article_id" = $1;`;
        const currentResult = await pool.query(currentQuery, [article_id]);
        const currentArticle = currentResult.rows[0];

        if (!currentArticle) {
            return null;
        }

        const { title, publication_year, version, issue_id, abstract, doi, primary_topic } = updateData;

        const fieldsToSet = [];
        const values = [article_id];

        if (title !== undefined) {
            const trimmedTitle = String(title).trim();
            if (trimmedTitle === '') {
                throw new Error('VALIDATION_ERROR: Tiêu đề không được để trống.');
            }
            if (trimmedTitle !== currentArticle.title) {
                fieldsToSet.push('title');
                values.push(trimmedTitle);
            }
        }

        if (publication_year !== undefined) {
            const yearNum = Number(publication_year);
            if (isNaN(yearNum) || yearNum <= 0) {
                throw new Error('VALIDATION_ERROR: Năm xuất bản phải là số dương hợp lệ.');
            }
            if (yearNum !== currentArticle.publication_year) {
                fieldsToSet.push('publication_year');
                values.push(yearNum);
            }
        }

        if (version !== undefined && version !== currentArticle.version) {
            fieldsToSet.push('version');
            values.push(version);
        }

        if (abstract !== undefined && abstract !== currentArticle.abstract) {
            fieldsToSet.push('abstract');
            values.push(abstract);
        }

        if (doi !== undefined && doi !== currentArticle.doi) {
            fieldsToSet.push('doi');
            values.push(doi);
        }

        if (issue_id !== undefined) {
            if (String(currentArticle.issue_id) === String(issue_id)) {
                throw new Error('VALIDATION_ERROR: Không thể cập nhật cùng một mã issue.');
            }

            const issueExistsResult = await issueExists(issue_id);
            if (!issueExistsResult) {
                throw new Error('VALIDATION_ERROR: Mã Issue ID không tồn tại trên hệ thống.');
            }

            fieldsToSet.push('issue_id');
            values.push(issue_id);
        }

        if (primary_topic !== undefined) {
            if (Number(primary_topic) === 0) {
                if (currentArticle.primary_topic !== null) {
                    fieldsToSet.push('primary_topic');
                    values.push(null);
                }
            } else {
                if (String(currentArticle.primary_topic) === String(primary_topic)) {
                    throw new Error('VALIDATION_ERROR: Không thể cập nhật cùng giá trị Primary Topic.');
                }

                const isTopicExists = await topicExists(primary_topic);
                if (!isTopicExists) {
                    throw new Error('VALIDATION_ERROR: Primary topic không tồn tại trên hệ thống.');
                }

                fieldsToSet.push('primary_topic');
                values.push(primary_topic);
            }
        }

        if (fieldsToSet.length === 0) {
            return currentArticle;
        }

        const setClause = fieldsToSet
            .map((field, index) => `"${field}" = $${index + 2}`)
            .join(', ');

        // 6. Thực thi câu lệnh UPDATE xuống Postgres
        const query = `
            UPDATE "Article"
            SET ${setClause}
            WHERE "article_id" = $1
            RETURNING 
                article_id,
                version,
                issue_id,
                title,
                abstract,
                publication_year,
                doi,
                primary_topic,
                created_at;
        `;

        const result = await pool.query(query, values);

        await cacheService.delByPattern('article:list:*');
        await cacheService.delByPattern('article:count:*');
        await cacheService.del('article:stats:all');
        await cacheService.del(`article:detail:${article_id}`);

        const updatedArticle = result.rows[0] || null;
        return updatedArticle;
    } catch (error) {
        throw error; // Quăng lỗi lên để Controller bắt lấy và trả về res.status
    }
};

/**
 * Xóa mềm một bản ghi bài báo dựa trên ID (Chuyển is_deleted thành TRUE).
 *
 * @param {number|string} articleId - ID của bài báo cần xóa mềm
 * @returns {Promise<Object|null>} Bản ghi bài báo sau khi được cập nhật xóa mềm, hoặc null nếu không tìm thấy
 */
export const deleteArticle = async (articleId) => {
    try {
        // Kiểm tra đầu vào bắt buộc
        if (!articleId) {
            throw new Error('Article ID is required for deletion.');
        }

        const query = `
            UPDATE "Article"
            SET "is_deleted" = TRUE
            WHERE "article_id" = $1 AND "is_deleted" = FALSE
            RETURNING *;
        `;

        const values = [articleId];

        const result = await pool.query(query, values);

        await cacheService.delByPattern('article:list:*');
        await cacheService.delByPattern('article:count:*');
        await cacheService.del('article:stats:all');
        await cacheService.del(`article:detail:${articleId}`);

        return result.rows[0] || null;

    } catch (error) {
        logger.error(`Error soft-deleting article with ID ${articleId}:`, error);
        throw error;
    }
};

/**
 * Khôi phục một bài báo đã bị xóa mềm (Chuyển is_deleted thành FALSE).
 *
 * @param {number|string} articleId - ID của bài báo cần khôi phục
 * @returns {Promise<Object|null>} Bản ghi bài báo sau khi khôi phục, hoặc null nếu không tìm thấy
 */
export const restoreArticle = async (articleId) => {
    try {
        // Kiểm tra đầu vào bắt buộc
        if (!articleId) {
            throw new Error('Article ID is required for restoration.');
        }

        const query = `
            UPDATE "Article"
            SET "is_deleted" = FALSE
            WHERE "article_id" = $1 AND "is_deleted" = TRUE
            RETURNING *;
        `;

        const values = [articleId];

        const result = await pool.query(query, values);

        await cacheService.delByPattern('article:list:*');
        await cacheService.delByPattern('article:count:*');
        await cacheService.del('article:stats:all');
        await cacheService.del(`article:detail:${articleId}`);

        const restoredArticle = result.rows[0] || null;
        return restoredArticle;

    } catch (error) {
        logger.error(`Error restoring article with ID ${articleId}:`, error);
        throw error;
    }
};

/**
 * Kiểm tra sự tồn tại của một bài báo dựa trên `article_id`.
 * Hàm này sẽ trả về `true` nếu bài báo tồn tại (bất kể đã bị xóa mềm hay chưa), và `false` nếu không tìm thấy.
 *
 * @param {number|string} articleId - ID của bài báo cần kiểm tra
 * @returns {Promise<boolean>} `true` nếu bài báo tồn tại, `false` nếu không tìm thấy
 */
export const articleExists = async (articleId) => {
    try {
        const query = `SELECT EXISTS (SELECT 1 FROM "Article" WHERE "article_id" = $1);`;
        const result = await pool.query(query, [articleId]);
        return result.rows[0].exists;
    } catch (error) {
        logger.error(`Error checking if article with ID ${articleId} exists:`, error);
        throw error;
    }

}
