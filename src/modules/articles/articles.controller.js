import * as articleService from "./articles.service.js";
import {
  createAuthorArticleRelationships,
  updateAuthorArticleRelationships,
  checkAuthorsExistence
} from "../authors/authors.service.js";
import {
  addKeywordsToArticle,
  updateKeywordsToArticle,
} from "../keywords/keywords.service.js";
import { createSubTopicArticleRelationships } from "../topics/topics.service.js";
import logger from "../../utils/logger.js";
import { createLog } from '../../services/log.service.js';
import cacheService from '../../services/cache.service.js';
import crypto from 'crypto';

/**
 * Tìm kiếm bài báo theo danh sách từ khóa chuyên biệt.
 */
export const getArticlesByKeywords = async (request, reply) => {
  try {
    const rawKeywords = request.query.keywords;

    if (!rawKeywords || rawKeywords.trim() === "") {
      return reply.code(400).send({
        success: false,
        code: "MISSING_KEYWORDS",
        message:
          "Vui lòng cung cấp tham số 'keywords' trong query string! Ví dụ: ?keywords=Machine Learning,Deep Learning",
      });
    }

    const keywords = rawKeywords
      .split(",")
      .map((kw) => kw.trim().toLowerCase())
      .filter((kw) => kw.length > 0);

    if (keywords.length === 0) {
      return reply.code(400).send({
        success: false,
        code: "INVALID_KEYWORDS",
        message: "Danh sách keyword không hợp lệ!",
      });
    }

    const limit = parseInt(request.query.limit, 10) || 20;
    const page = parseInt(request.query.page, 10) || 1;
    const offset = (page - 1) * limit;

    const [articles, total] = await Promise.all([
      articleService.getArticlesByKeywords(keywords, limit, offset),
      articleService.countArticlesByKeywords(keywords),
    ]);

    return reply.code(200).send({
      success: true,
      code: "ARTICLES_GET_BY_KEYWORDS_SUCCESS",
      message: "Lấy danh sách bài báo thành công!",
      data: {
        articles: articles,
        pagination: {
          total: total,
          page: page,
          limit: limit,
          total_pages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    logger.error("getArticlesByKeywords error:", error);
    return reply.code(500).send({
      success: false,
      code: "INTERNAL_SERVER_ERROR",
      message: "Có lỗi xảy ra ở Server!",
    });
  }
};

/**
 * Lấy danh sách bài báo public, hỗ trợ search/filter/sort/pagination.
 */
export const getArticles = async (request, reply) => {
  try {
    let page = parseInt(request.query.page, 10) || 1;
    let limit = parseInt(request.query.limit, 10) || 10;
    if (page <= 0) page = 1;
    if (limit <= 0) limit = 10;
    if (limit > 100) limit = 100;

    const offset = (page - 1) * limit;
    const sortBy = request.query.sortBy || "created_at";
    const sortOrder = (request.query.sortOrder || "DESC").toUpperCase();

    const serviceParams = {
      limit,
      offset,
      search: (request.query.search || "").trim(),
      sortBy,
      sortOrder,
      publicationYear: request.query.publication_year || request.query.year,
      journalId: request.query.journal_id || request.query.journal,
      topicId: request.query.topic_id || request.query.topic,
      volumeId: request.query.volume_id,
      issueId: request.query.issue_id,
      isOpenAccess: request.query.is_open_access || request.query.access,
      countryId: request.query.country_id || request.query.country,
    };

    if (serviceParams.isOpenAccess === "all" || serviceParams.isOpenAccess === "" || serviceParams.isOpenAccess === undefined) {
      serviceParams.isOpenAccess = undefined;
    } else if (serviceParams.isOpenAccess === "oa" || serviceParams.isOpenAccess === "true" || serviceParams.isOpenAccess === true) {
      serviceParams.isOpenAccess = true;
    } else if (serviceParams.isOpenAccess === "closed" || serviceParams.isOpenAccess === "non-oa" || serviceParams.isOpenAccess === "false" || serviceParams.isOpenAccess === false) {
      serviceParams.isOpenAccess = false;
    } else {
      serviceParams.isOpenAccess = undefined;
    }

    const cacheKey = `api:articles:get:${crypto.createHash('md5').update(JSON.stringify({ ...serviceParams, page })).digest('hex')}`;
    const cachedResponse = await cacheService.get(cacheKey);
    if (cachedResponse) {
      return reply.code(200).send(cachedResponse);
    }

    const [articles, total] = await Promise.all([
      articleService.getAllArticles(serviceParams),
      articleService.countAllArticles(serviceParams)
    ]);

    let stats = { totalArticles: 0, openAccessCount: 0, authorsCount: 0, topicsCount: 0 };
    try {
      stats = await articleService.getArticleListStats();
    } catch (statsError) {
      logger.error("Lỗi riêng lẻ khi lấy stats:", statsError);
    }

    const responsePayload = {
      success: true,
      code: "ARTICLES_GET_SUCCESS",
      message: "Lấy danh sách bài báo thành công!",
      data: {
        articles,
        items: articles,
        pagination: {
          page,
          limit,
          total,
          total_pages: Math.ceil(total / limit),
        },
        stats,
      },
    };

    await cacheService.set(cacheKey, responsePayload, 300);

    return reply.code(200).send(responsePayload);
  } catch (error) {
    logger.error("Lỗi khi lấy danh sách bài báo:", error);
    return reply.code(500).send({
      success: false,
      code: "INTERNAL_SERVER_ERROR",
      message: "Có lỗi xảy ra ở Server!",
    });
  }
};

/**
 * Router handler tổng hợp: chuyển hướng chế độ tìm kiếm.
 */
export const getArticle = async (request, reply) => {
  const rawKeywords = request.query.keywords;
  if (!rawKeywords || rawKeywords.trim() === "") {
    return getArticles(request, reply);
  } else {
    return getArticlesByKeywords(request, reply);
  }
};

/**
 * Lấy các tùy chọn bộ lọc cho bài báo (năm thực tế, top journals, top topics).
 */
export const getArticleFilterOptions = async (request, reply) => {
  try {
    const filterOptions = await articleService.getArticleFilterMetadata();
    return reply.code(200).send({
      success: true,
      code: "ARTICLE_FILTER_OPTIONS_SUCCESS",
      message: "Lấy tùy chọn bộ lọc bài báo thành công!",
      data: filterOptions,
    });
  } catch (error) {
    logger.error("Lỗi khi lấy filter options bài báo:", error);
    return reply.code(500).send({
      success: false,
      code: "INTERNAL_SERVER_ERROR",
      message: "Có lỗi xảy ra ở Server!",
    });
  }
};

/**
 * Lấy chi tiết một bài báo theo article_id.
 */
export const getArticleById = async (request, reply) => {
  try {
    const { id } = request.params;
    
    // Validate ID
    if (!articleService.articleExists(Number(id))) {
      return reply.code(404).send({
        success: false,
        code: "ARTICLE_NOT_FOUND",
        message: "Không tìm thấy Article với ID đã cho"
      });
    }

    const article = await articleService.getArticleById(id);

    if (!article) {
      return reply.code(404).send({
        success: false,
        code: "ARTICLE_NOT_FOUND",
        message: "Bài báo không tồn tại!",
      });
    }

    if (article.is_deleted === true) {
      return reply.code(410).send({
        success: false,
        code: "ARTICLE_DELETED",
        message: "Bài báo này đã bị xóa khỏi hệ thống!",
      });
    }

    return reply.code(200).send({
      success: true,
      code: "ARTICLE_GET_SUCCESS",
      message: "Lấy thông tin bài báo thành công!",
      data: article,
    });
  } catch (error) {
    logger.error("Lỗi khi lấy thông tin bài báo theo ID:", error);
    return reply.code(500).send({
      success: false,
      code: "INTERNAL_SERVER_ERROR",
      message: "Có lỗi xảy ra ở Server!",
    });
  }
};

/**
 * Tạo mới một bài báo đầy đủ.
 */
export const createArticle = async (request, reply) => {
  const {
    title,
    publication_year,
    version,
    issue_id,
    abstract,
    doi,
    primary_topic,
    sub_topic,
    authors,
    keywords,
  } = request.body;

  // Manual check for authors from legacy middleware
  if (Array.isArray(authors) && authors.length > 0) {
    try {
      const authorIdsNotExist = await checkAuthorsExistence(authors);
      if (authorIdsNotExist.length > 0) {
        return reply.code(400).send({
          success: false,
          code: "AUTHORS_NOT_FOUND",
          message: `Các tác giả với ID sau không tồn tại: ${authorIdsNotExist.join(", ")}`,
        });
      }
    } catch (error) {
      return reply.code(500).send({ success: false, code: "INTERNAL_SERVER_ERROR", message: "Lỗi hệ thống khi xác thực tác giả!" });
    }
  }

  try {
    const newArticle = await articleService.createArticle({
      version,
      issue_id,
      title,
      abstract,
      publication_year,
      doi,
      primary_topic: primary_topic == 0 ? null : primary_topic,
    });

    // 2. Tạo các quan hệ đồng bộ
    await createAuthorArticleRelationships(
      newArticle.article_id,
      authors || [],
    );
    await createSubTopicArticleRelationships(
      newArticle.article_id,
      sub_topic || [],
      primary_topic == 0 ? null : primary_topic,
    );

    const hasKeywords =
      keywords &&
      (Array.isArray(keywords)
        ? keywords.length > 0
        : Object.keys(keywords).length > 0);
    if (hasKeywords) {
      await addKeywordsToArticle(newArticle.article_id, keywords);
    }

    createLog({
      userId: request.user?.user_id,
      userRole: request.user?.role,
      action: 'CREATE',
      entityTable: 'Article',
      entityId: newArticle.article_id,
      message: `Tạo mới bài báo: ${newArticle.title}`,
      metadata: { ip: request.ip }
    });

    return reply.code(201).send({
      success: true,
      code: "ARTICLE_CREATE_SUCCESS",
      message: "Bài báo đã được tạo thành công!",
      data: newArticle,
    });
  } catch (error) {
    logger.error("Lỗi khi tạo dữ liệu bài báo tại Controller:", error);
    if (error.statusCode === 400) {
      return reply.code(400).send({
        success: false,
        code: "VALIDATION_ERROR",
        message: error.message,
      });
    }
    return reply.code(500).send({
      success: false,
      code: "INTERNAL_SERVER_ERROR",
      message: "Có lỗi xảy ra ở Server!",
    });
  }
};

/**
 * Cập nhật thông tin bài báo theo ID.
 */
export const updateArticle = async (request, reply) => {
  const { id } = request.params;
  const dataBody = request.body;
  
  // Validate ID
  if (!articleService.articleExists(Number(id))) {
    return reply.code(404).send({
      success: false,
      code: "ARTICLE_NOT_FOUND",
      message: "Không tìm thấy Article với ID đã cho"
    });
  }

  if (dataBody.authors !== undefined) {
    const normalizedAuthors = dataBody.authors
      .map((item) => {
        if (typeof item === "object" && item !== null) {
          return Number(item.author_id || item.id);
        }
        return Number(item);
      })
      .filter((aId) => !isNaN(aId) && aId > 0);

    if (normalizedAuthors.length > 0) {
      try {
        const authorIdsNotExist = await checkAuthorsExistence(normalizedAuthors);
        if (authorIdsNotExist.length > 0) {
          return reply.code(400).send({
            success: false,
            code: "AUTHORS_NOT_FOUND",
            message: `Các tác giả với ID sau không tồn tại: ${authorIdsNotExist.join(", ")}`,
          });
        }
      } catch (error) {
        return reply.code(500).send({
          success: false,
          code: "INTERNAL_SERVER_ERROR",
          message: "Lỗi hệ thống khi xác thực tác giả!",
        });
      }
    }
    dataBody.authors = normalizedAuthors;
  }

  try {
    const article = await articleService.getArticleById(id);
    if (!article) {
      return reply.code(404).send({
        success: false,
        code: "ARTICLE_NOT_FOUND",
        message: "Article không tìm thấy",
      });
    }

    const updatedArticle = await articleService.updateArticle({
      article_id: article.article_id,
      ...dataBody,
    });

    if (dataBody.authors !== undefined) {
      await updateAuthorArticleRelationships(id, dataBody.authors);
    }

    if (dataBody.keywords !== undefined) {
      await updateKeywordsToArticle(id, dataBody.keywords);
    }

    createLog({
      userId: request.user?.user_id,
      userRole: request.user?.role,
      action: 'UPDATE',
      entityTable: 'Article',
      entityId: updatedArticle.article_id,
      message: `Cập nhật bài báo: ${updatedArticle.title}`,
      metadata: { ip: request.ip }
    });

    return reply.code(200).send({
      success: true,
      code: "ARTICLE_UPDATE_SUCCESS",
      message: "Article updated successfully",
      data: updatedArticle,
    });
  } catch (error) {
    if (error.message && error.message.startsWith("VALIDATION_ERROR:")) {
      const cleanMessage = error.message.replace("VALIDATION_ERROR: ", "");
      return reply.code(400).send({
        success: false,
        code: "VALIDATION_ERROR",
        message: cleanMessage,
      });
    }
    return reply.code(500).send({
      success: false,
      code: "INTERNAL_SERVER_ERROR",
      message: "Internal server error",
    });
  }
};

/**
 * Xóa mềm bài báo.
 */
export const deleteArticle = async (request, reply) => {
  const { id } = request.params;
  
  // Validate ID
  if (!articleService.articleExists(Number(id))) {
    return reply.code(404).send({
      success: false,
      code: "ARTICLE_NOT_FOUND",
      message: "Không tìm thấy Article với ID đã cho"
    });
  }

  try {
    const article = await articleService.getArticleById(id);
    if (!article) {
      return reply.code(404).send({
        success: false,
        code: "ARTICLE_NOT_FOUND",
        message: "Article không tìm thấy",
      });
    }

    await articleService.deleteArticle(id);

    createLog({
      userId: request.user?.user_id,
      userRole: request.user?.role,
      action: 'DELETE',
      entityTable: 'Article',
      entityId: id,
      message: `Xóa mềm bài báo có ID: ${id}`,
      metadata: { ip: request.ip }
    });

    return reply.code(200).send({
      success: true,
      code: "ARTICLE_DELETE_SUCCESS",
      message: "Article đã xóa thành công",
    });
  } catch (error) {
    return reply.code(500).send({
      success: false,
      code: "INTERNAL_SERVER_ERROR",
      message: "Internal server error",
    });
  }
};

/**
 * Khôi phục một bài báo đã bị xóa mềm.
 */
export const restoreArticle = async (request, reply) => {
  const { id } = request.params;
  
  // Validate ID
  if (!articleService.articleExists(Number(id))) {
    return reply.code(404).send({
      success: false,
      code: "ARTICLE_NOT_FOUND",
      message: "Không tìm thấy Article với ID đã cho"
    });
  }

  try {
    const restored = await articleService.restoreArticle(id);
    if (!restored) {
      return reply.code(404).send({
        success: false,
        code: "ARTICLE_NOT_FOUND",
        message: "Article không tìm thấy hoặc đã được khôi phục",
      });
    }

    return reply.code(200).send({
      success: true,
      code: "ARTICLE_RESTORE_SUCCESS",
      message: "Article đã khôi phục thành công",
      data: restored,
    });
  } catch (error) {
    logger.error(`Error restoring article ${id}:`, error);
    return reply.code(500).send({
      success: false,
      code: "INTERNAL_SERVER_ERROR",
      message: "Internal server error",
    });
  }
};
