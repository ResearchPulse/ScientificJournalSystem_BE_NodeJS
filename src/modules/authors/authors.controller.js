import * as authorService from "./authors.service.js";
import logger from "../../utils/logger.js";

const AUTHOR_CODES = {
  AUTHOR_LIST_FETCHED: "AUTHOR_LIST_FETCHED",
  AUTHOR_FETCHED: "AUTHOR_FETCHED",
  AUTHOR_CREATED: "AUTHOR_CREATED",
  AUTHOR_UPDATED: "AUTHOR_UPDATED",
  AUTHOR_DELETED: "AUTHOR_DELETED",
  AUTHOR_RESTORED: "AUTHOR_RESTORED",
  AUTHOR_INVALID_LIMIT: "AUTHOR_INVALID_LIMIT",
  AUTHOR_ARTICLES_FETCHED: "AUTHOR_ARTICLES_FETCHED",
  AUTHOR_LEADERBOARD_FETCHED: "AUTHOR_LEADERBOARD_FETCHED",
  AREA_BREAKDOWN_FETCHED: "AREA_BREAKDOWN_FETCHED",
  AUTHOR_INVALID_ID: "AUTHOR_INVALID_ID",
  AUTHOR_INVALID_BODY: "AUTHOR_INVALID_BODY",
  AUTHOR_NOT_FOUND: "AUTHOR_NOT_FOUND",
  AUTHOR_ALREADY_DELETED: "AUTHOR_ALREADY_DELETED",
  AUTHOR_ALREADY_ACTIVE: "AUTHOR_ALREADY_ACTIVE",
  AUTHOR_INVALID_PAGINATION: "AUTHOR_INVALID_PAGINATION",
  AUTHOR_SERVER_ERROR: "AUTHOR_SERVER_ERROR",
};

export const getAuthorAreasBreakdown = async (request, reply) => {
  try {
    const authorId = Number(request.params.id);

    const authorInfo = await authorService.getAuthorById(authorId);
    if (!authorInfo) {
      return reply.code(404).send({
        success: false,
        code: AUTHOR_CODES.AUTHOR_NOT_FOUND,
        message: "Tác giả không tồn tại",
      });
    }

    const areasBreakdown = await authorService.getAuthorAreasBreakdownService(authorId);

    return reply.code(200).send({
      success: true,
      message: "Phân tích lĩnh vực nghiên cứu của tác giả thành công",
      code: AUTHOR_CODES.AREA_BREAKDOWN_FETCHED,
      data: {
        ...authorInfo,
        breakdown: areasBreakdown,
      },
    });
  } catch (error) {
    logger.error("Lỗi phân tích lĩnh vực nghiên cứu của tác giả:", error);
    return reply.code(500).send({
      success: false,
      code: AUTHOR_CODES.AUTHOR_SERVER_ERROR,
      message: "Có lỗi xảy ra ở Server!",
    });
  }
};

export const getAuthorArticles = async (request, reply) => {
  try {
    const authorId = Number(request.params.id);
    const limit = request.query.limit !== undefined ? Number(request.query.limit) : 10;
    const page = request.query.page !== undefined ? Number(request.query.page) : 1;

    const result = await authorService.getAuthorArticlesService(authorId, limit, page);

    return reply.code(200).send({
      success: true,
      code: AUTHOR_CODES.AUTHOR_ARTICLES_FETCHED,
      message: "Lấy bài viết của tác giả thành công",
      pagination: result.pagination,
      data: result.items,
    });
  } catch (error) {
    logger.error("Lỗi lấy bài viết của tác giả:", error);
    return reply.code(500).send({
      success: false,
      code: AUTHOR_CODES.AUTHOR_SERVER_ERROR,
      message: "Có lỗi xảy ra ở Server!",
    });
  }
};

export const getAuthorLeaderboard = async (request, reply) => {
  try {
    const limit = Number(request.query.limit) || 10;
    const page = Number(request.query.page) || 1;
    const subject_area = request.query.subject_area || "";
    const period = request.query.period || "all";

    const result = await authorService.getAuthorLeaderboardService(limit, page, subject_area, period);

    return reply.code(200).send({
      success: true,
      code: AUTHOR_CODES.AUTHOR_LEADERBOARD_FETCHED,
      message: "Lấy bảng xếp hạng tác giả thành công",
      pagination: result.pagination,
      data: result.items,
    });
  } catch (error) {
    logger.error("Lỗi lấy bảng xếp hạng tác giả:", error);
    return reply.code(500).send({
      success: false,
      code: AUTHOR_CODES.AUTHOR_SERVER_ERROR,
      message: "Có lỗi xảy ra ở Server!",
    });
  }
};

export const getAllAuthorsController = async (request, reply) => {
  try {
    const page = request.query.page || 1;
    const limit = request.query.limit || 10;
    const search = request.query.search || "";
    const sort = request.query.sort || "impact";
    const subject_area = request.query.subject_area || request.query.subject_area_id || "";
    const country = request.query.country || "";

    const result = await authorService.getAllAuthors({
      page,
      limit,
      search,
      sort,
      subject_area,
      country,
    });

    return reply.code(200).send({
      success: true,
      code: AUTHOR_CODES.AUTHOR_LIST_FETCHED,
      message: "Lấy danh sách tác giả thành công",
      data: result.data,
      pagination: result.pagination,
    });
  } catch (error) {
    logger.error("[Author Controller] Lỗi khi lấy danh sách tác giả:", error);
    return reply.code(500).send({
      success: false,
      code: AUTHOR_CODES.AUTHOR_SERVER_ERROR,
      message: "Có lỗi xảy ra ở Server!",
    });
  }
};

export const getAuthorByIdController = async (request, reply) => {
  try {
    const idParam = request.params.id;
    const author = await authorService.getAuthorById(idParam);
    
    if (!author) {
      return reply.code(404).send({
        success: false,
        code: AUTHOR_CODES.AUTHOR_NOT_FOUND,
        message: "Tác giả không tồn tại",
      });
    }

    return reply.code(200).send({
      success: true,
      code: AUTHOR_CODES.AUTHOR_FETCHED,
      message: "Lấy thông tin tác giả thành công",
      data: author,
    });
  } catch (error) {
    logger.error("[Author Controller] Lỗi khi lấy tác giả theo ID:", error);
    return reply.code(500).send({
      success: false,
      code: AUTHOR_CODES.AUTHOR_SERVER_ERROR,
      message: "Có lỗi xảy ra ở Server!",
    });
  }
};

export const createAuthorController = async (request, reply) => {
  try {
    const author = await authorService.createAuthor(request.body);
    return reply.code(201).send({
      success: true,
      code: AUTHOR_CODES.AUTHOR_CREATED,
      message: "Tạo tác giả thành công",
      data: author,
    });
  } catch (error) {
    logger.error("[Author Controller] Lỗi khi tạo tác giả:", error);
    return reply.code(500).send({
      success: false,
      code: AUTHOR_CODES.AUTHOR_SERVER_ERROR,
      message: "Có lỗi xảy ra ở Server!",
    });
  }
};

export const updateAuthorController = async (request, reply) => {
  try {
    const author = await authorService.updateAuthor(request.params.id, request.body);
    return reply.code(200).send({
      success: true,
      code: AUTHOR_CODES.AUTHOR_UPDATED,
      message: "Cập nhật tác giả thành công",
      data: author,
    });
  } catch (error) {
    if (error.statusCode) {
      return reply.code(error.statusCode).send({
        success: false,
        code: error.code,
        message: error.message,
      });
    }
    logger.error("[Author Controller] Lỗi khi cập nhật tác giả:", error);
    return reply.code(500).send({
      success: false,
      code: AUTHOR_CODES.AUTHOR_SERVER_ERROR,
      message: "Có lỗi xảy ra ở Server!",
    });
  }
};

export const deleteAuthorController = async (request, reply) => {
  try {
    await authorService.deleteAuthor(request.params.id);
    return reply.code(200).send({
      success: true,
      code: AUTHOR_CODES.AUTHOR_DELETED,
      message: "Xóa tác giả thành công",
    });
  } catch (error) {
    if (error.statusCode) {
      return reply.code(error.statusCode).send({
        success: false,
        code: error.code,
        message: error.message,
      });
    }
    logger.error("[Author Controller] Lỗi khi xóa tác giả:", error);
    return reply.code(500).send({
      success: false,
      code: AUTHOR_CODES.AUTHOR_SERVER_ERROR,
      message: "Có lỗi xảy ra ở Server!",
    });
  }
};

export const restoreAuthorController = async (request, reply) => {
  try {
    const author = await authorService.restoreAuthor(request.params.id);
    return reply.code(200).send({
      success: true,
      code: AUTHOR_CODES.AUTHOR_RESTORED,
      message: "Khôi phục tác giả thành công",
      data: author,
    });
  } catch (error) {
    if (error.statusCode) {
      return reply.code(error.statusCode).send({
        success: false,
        code: error.code,
        message: error.message,
      });
    }
    logger.error("[Author Controller] Lỗi khi restore tác giả:", error);
    return reply.code(500).send({
      success: false,
      code: AUTHOR_CODES.AUTHOR_SERVER_ERROR,
      message: "Có lỗi xảy ra ở Server!",
    });
  }
};
