import * as keywordService from "./keywords.service.js";
import logger from "../../utils/logger.js";
import cacheService from '../../services/cache.service.js';
import crypto from 'crypto';

const validateDisplayName = (display_name) => {
  if (!display_name) return "Tên keyword không được để trống";
  if (display_name.length < 2) return "Tên keyword phải có ít nhất 2 ký tự";
  if (display_name.length > 255) return "Tên keyword không được vượt quá 255 ký tự";
  if (/[!@#$%^&*()_+={}\[\]|\\:;"'<>,?\/~`]/.test(display_name))
    return "Tên keyword không được chứa ký tự đặc biệt";
  if (/<[^>]*>/.test(display_name))
    return "Tên keyword không được chứa HTML hoặc script";
  return null;
};

export const getTrendingKeywords = async (request, reply) => {
  try {
    const projectId = parseInt(request.params.id);

    const cacheKey = `keywords:trending:project:${projectId}:${crypto.createHash('md5').update(JSON.stringify(request.query)).digest('hex')}`;
    const cachedData = await cacheService.get(cacheKey);
    if (cachedData) return reply.code(200).send(cachedData);

    const result = await keywordService.getTrendingKeywords(projectId, request.query);

    const responseData = {
      success: true,
      message: "Lấy danh sách từ khóa trending thành công",
      data: result,
    };
    await cacheService.set(cacheKey, responseData);
    return reply.code(200).send(responseData);
  } catch (error) {
    logger.error("[Keyword Controller] Lỗi khi lấy trending keywords:", error);
    return reply.code(500).send({
      success: false,
      message: "Có lỗi xảy ra ở server khi lấy trending keywords",
    });
  }
};

export const getWatchedKeywordArticles = async (request, reply) => {
  try {
    const projectId = parseInt(request.params.id);
    const userId = request.user.user_id;

    const result = await keywordService.getWatchedKeywordArticles(
      projectId,
      userId,
      request.query,
    );

    return reply.code(200).send({
      success: true,
      message: "Lấy luồng bài báo từ từ khóa theo dõi thành công",
      data: result.data,
      pagination: {
        page: result.page,
        limit: result.limit,
        total: result.total,
        total_pages: result.total_pages,
      },
    });
  } catch (error) {
    if (error.statusCode === 400) {
      return reply.code(400).send({
        success: false,
        message: error.message,
      });
    }
    logger.error("[Keyword Controller] Lỗi khi lấy watched keyword articles:", error);
    return reply.code(500).send({
      success: false,
      message: "Có lỗi xảy ra ở server khi lấy bài báo theo dõi",
    });
  }
};

export const watchKeywords = async (request, reply) => {
  try {
    const projectId = parseInt(request.params.id);
    const { keyword_ids } = request.body || {};

    const result = await keywordService.addWatchedKeywords(projectId, keyword_ids);

    if (!result.success) {
      return reply.code(400).send({
        success: false,
        code: "ERROR_KEYWORDS_ALREADY_WATCHED",
        message: "Có từ khóa đã tồn tại trong danh sách theo dõi của dự án, không thể thêm mới",
      });
    }

    return reply.code(201).send({
      success: true,
      code: "SUCCESS_CREATE_WATCHED_KEYWORDS",
      message: `Thêm thành công ${result.insertedCount} từ khóa vào danh sách theo dõi`,
    });
  } catch (error) {
    logger.error("[watchKeywords] Error:", error);
    return reply.code(500).send({
      success: false,
      code: "ERROR_SERVER_CREATE_WATCHED_KEYWORD",
      message: "Có lỗi xảy ra ở Server!",
    });
  }
};

export const deleteWatchedKeyword = async (request, reply) => {
  try {
    const projectId = parseInt(request.params.id);
    const keywordId = parseInt(request.params.keywordId);

    const userId = request.user.user_id;
    const isOwner = await keywordService.checkProjectOwnership(projectId, userId);
    if (!isOwner) {
      return reply.code(403).send({
        success: false,
        code: "ERROR_FORBIDDEN_DELETE_WATCHED_KEYWORD",
        message: "Không tìm thấy dự án hoặc bạn không có quyền truy cập dự án này",
      });
    }

    const isDeleted = await keywordService.removeWatchedKeyword(projectId, keywordId);

    if (!isDeleted) {
      return reply.code(404).send({
        success: false,
        code: "ERROR_KEYWORD_NOT_FOUND",
        message: "Từ khóa không nằm trong danh sách theo dõi của dự án",
      });
    }

    return reply.code(200).send({
      success: true,
      code: "SUCCESS_DELETE_WATCHED_KEYWORD",
      message: "Đã xóa từ khóa khỏi dự án thành công",
    });
  } catch (error) {
    logger.error("[deleteWatchedKeyword] Lỗi khi xóa từ khóa theo dõi:", error);
    return reply.code(500).send({
      success: false,
      code: "ERROR_SERVER_DELETE_WATCHED_KEYWORD",
      message: "Có lỗi xảy ra ở server khi xóa từ khóa",
    });
  }
};

export const updateWatchedKeywords = async (request, reply) => {
  try {
    const projectId = parseInt(request.params.id);
    const { keyword_ids } = request.body || {};

    await keywordService.replaceWatchedKeywords(projectId, keyword_ids || []);

    return reply.code(200).send({
      success: true,
      code: "SUCCESS_UPDATE_WATCHED_KEYWORD",
      message: "Cập nhật danh sách từ khóa theo dõi thành công",
    });
  } catch (error) {
    logger.error("[updateWatchedKeywords] Lỗi khi cập nhật từ khóa theo dõi:", error);
    return reply.code(500).send({
      success: false,
      code: "ERROR_SERVER_UPDATE_WATCHED_KEYWORD",
      message: "Có lỗi xảy ra ở server khi cập nhật từ khóa",
    });
  }
};

export const getAllKeywordsController = async (request, reply) => {
  try {
    const page = Math.max(parseInt(request.query.page) || 1, 1);
    const limit = Math.min(parseInt(request.query.limit) || 10, 100);
    const search = request.query.search || request.query.keyword || "";
    const subject_area_id = request.query.subject_area_id ? parseInt(request.query.subject_area_id, 10) : undefined;
    const result = await keywordService.getAllKeywords({ page, limit, search, subject_area_id });
    
    return reply.code(200).send({
      success: true,
      code: "KEYWORD_LIST_FETCHED",
      message: "Lấy danh sách keyword thành công",
      data: result.data,
      pagination: result.pagination,
    });
  } catch (error) {
    logger.error("[Keyword Controller] Lỗi khi lấy danh sách keyword:", error);
    return reply.code(500).send({
      success: false,
      code: "KEYWORD_SERVER_ERROR",
      message: "Có lỗi xảy ra ở Server!",
    });
  }
};

export const createKeywordController = async (request, reply) => {
  try {
    const errorMsg = validateDisplayName(request.body.display_name);
    if (errorMsg) {
      return reply.code(400).send({ success: false, message: errorMsg });
    }

    const keyword = await keywordService.createKeyword(request.body.display_name);
    return reply.code(201).send({
      success: true,
      code: "KEYWORD_CREATED",
      message: "Tạo keyword thành công",
      data: keyword,
    });
  } catch (error) {
    if (error.statusCode) {
      return reply.code(error.statusCode).send({
        success: false,
        code: error.code,
        message: error.message,
      });
    }
    logger.error("[Keyword Controller] Lỗi khi tạo keyword:", error);
    return reply.code(500).send({
      success: false,
      code: "KEYWORD_SERVER_ERROR",
      message: "Có lỗi xảy ra ở Server!",
    });
  }
};

export const getKeywordByIdController = async (request, reply) => {
  try {
    const keywordId = request.params.id;
    const keyword = await keywordService.getKeywordById(keywordId);
    return reply.code(200).send({
      success: true,
      code: "KEYWORD_FETCHED",
      message: "Lấy keyword thành công",
      data: keyword,
    });
  } catch (error) {
    if (error.statusCode) {
      return reply.code(error.statusCode).send({
        success: false,
        code: error.code,
        message: error.message,
      });
    }
    logger.error("[Keyword Controller] Lỗi khi lấy keyword theo ID:", error);
    return reply.code(500).send({
      success: false,
      code: "KEYWORD_SERVER_ERROR",
      message: "Có lỗi xảy ra ở Server!",
    });
  }
};

export const getArticlesByKeywordController = async (request, reply) => {
  try {
    const keywordId = request.params.id;
    const page = Math.max(parseInt(request.query.page) || 1, 1);
    const limit = Math.min(parseInt(request.query.limit) || 10, 50);
    const sortBy = request.query.sortBy || request.query.sort_by || "publication_year";
    const sortOrder = request.query.sortOrder || request.query.sort_order || "desc";

    const result = await keywordService.getArticlesByKeyword(keywordId, { page, limit, sortBy, sortOrder });
    return reply.code(200).send({
      success: true,
      code: "KEYWORD_ARTICLES_FETCHED",
      message: "Lấy danh sách bài báo theo keyword thành công",
      data: result.data,
      pagination: result.pagination,
    });
  } catch (error) {
    if (error.statusCode) {
      return reply.code(error.statusCode).send({
        success: false,
        code: error.code,
        message: error.message,
      });
    }
    logger.error("[Keyword Controller] Lỗi khi lấy bài báo theo keyword:", error);
    return reply.code(500).send({
      success: false,
      code: "KEYWORD_ARTICLE_SERVER_ERROR",
      message: "Có lỗi xảy ra ở Server!",
    });
  }
};

export const updateKeywordController = async (request, reply) => {
  try {
    const keywordId = request.params.id;
    const errorMsg = validateDisplayName(request.body.display_name);
    if (errorMsg) {
      return reply.code(400).send({ success: false, message: errorMsg });
    }

    const keyword = await keywordService.updateKeyword(keywordId, request.body.display_name);
    return reply.code(200).send({
      success: true,
      code: "KEYWORD_UPDATED",
      message: "Cập nhật keyword thành công",
      data: keyword,
    });
  } catch (error) {
    if (error.statusCode) {
      return reply.code(error.statusCode).send({
        success: false,
        code: error.code,
        message: error.message,
      });
    }
    logger.error("[Keyword Controller] Lỗi khi cập nhật keyword:", error);
    return reply.code(500).send({
      success: false,
      code: "KEYWORD_SERVER_ERROR",
      message: "Có lỗi xảy ra ở Server!",
    });
  }
};

export const deleteKeywordController = async (request, reply) => {
  try {
    const keywordId = request.params.id;
    await keywordService.deleteKeyword(keywordId);
    return reply.code(200).send({
      success: true,
      code: "KEYWORD_DELETED",
      message: "Xóa keyword thành công",
    });
  } catch (error) {
    if (error.statusCode) {
      return reply.code(error.statusCode).send({
        success: false,
        code: error.code,
        message: error.message,
      });
    }
    logger.error("[Keyword Controller] Lỗi khi xóa keyword:", error);
    return reply.code(500).send({
      success: false,
      code: "KEYWORD_SERVER_ERROR",
      message: "Có lỗi xảy ra ở Server!",
    });
  }
};

export const restoreKeywordController = async (request, reply) => {
  try {
    const keywordId = request.params.id;
    const keyword = await keywordService.restoreKeyword(keywordId);
    return reply.code(200).send({
      success: true,
      code: "KEYWORD_RESTORED",
      message: "Khôi phục keyword thành công",
      data: keyword,
    });
  } catch (error) {
    if (error.statusCode) {
      return reply.code(error.statusCode).send({
        success: false,
        code: error.code,
        message: error.message,
      });
    }
    logger.error("[Keyword Controller] Lỗi khi restore keyword:", error);
    return reply.code(500).send({
      success: false,
      code: "KEYWORD_SERVER_ERROR",
      message: "Có lỗi xảy ra ở Server!",
    });
  }
};
