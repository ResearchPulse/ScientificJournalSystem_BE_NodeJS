import * as projectService from "./projects.service.js";
import logger from "../../utils/logger.js";
import { createLog } from '../../services/log.service.js';
import { spendCoins } from '../wallet/wallet.service.js';
import cacheService from '../../services/cache.service.js';

export const projectServiceRef = { ...projectService };

/**
 * API Lấy danh sách dự án của người dùng hiện tại
 * @param {Object} req - Express request object
 * @param {Object} req.user - Thông tin người dùng đã xác thực
 * @param {string} req.user.user_id - ID người dùng
 * @param {Object} res - Express response object
 * @returns {Promise<Object>} JSON response chứa danh sách dự án
 */
export const getProjects = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const includeDeleted = req.query?.includeDeleted === 'true' || req.query?.status === 'ALL';
    const projects = await projectServiceRef.getUserProjects(userId, includeDeleted);

    return res.code(200).send({
      success: true,
      message: "Lấy danh sách dự án thành công",
      code: "SUCCESS_GET_PROJECTS",
      data: projects,
    });
  } catch (error) {
    logger.error("[Project Controller] Lỗi khi lấy danh sách dự án:", error);
    return res.code(500).send({
      success: false,
      code: "INTERNAL_SERVER_ERROR",
      message: "Có lỗi xảy ra khi lấy danh sách dự án",
    });
  }
};

/**
 * API Lấy chi tiết dự án theo ID và thuộc về người dùng hiện tại
 * @param {Object} req - Express request object
 * @param {Object} req.params - Các tham số trên URL
 * @param {string} req.params.id - ID của dự án cần lấy thông tin
 * @param {Object} req.user - Thông tin người dùng đã xác thực
 * @param {string} req.user.user_id - ID người dùng
 * @param {Object} res - Express response object
 * @returns {Promise<Object>} JSON response chứa thông tin chi tiết dự án
 */
export const getProjectById = async (req, res) => {
  try {
    const projectId = req.params.id;
    const userId = req.user.user_id;

    const project = await projectServiceRef.getProjectById(projectId, userId);
    if (!project) {
      return res.code(404).send({
        success: false,
        code: "PROJECT_NOT_FOUND_OR_ACCESS_DENIED",
        message:
          "Không tìm thấy dự án hoặc bạn không có quyền truy cập dự án này",
      });
    }

    return res.code(200).send({
      success: true,
      code: "SUCCESS_GET_PROJECT",
      message: "Lấy chi tiết dự án thành công",
      data: project,
    });
  } catch (error) {
    logger.error("[Project Controller] Lỗi khi lấy chi tiết dự án:", error);
    return res.code(500).send({
      success: false,
      code: "INTERNAL_SERVER_ERROR",
      message: "Có lỗi xảy ra khi lấy chi tiết dự án",
    });
  }
};

/**
 * API Tạo mới một dự án khoa học kèm theo các chuyên ngành và tạp chí liên kết
 * @param {Object} req - Express request object
 * @param {Object} req.user - Thông tin người dùng đã xác thực
 * @param {string} req.user.user_id - ID người dùng
 * @param {Object} req.body - Dữ liệu dự án truyền từ client
 * @param {string} req.body.title - Tiêu đề dự án
 * @param {number|string} [req.body.subject_area] - ID lĩnh vực chính
 * @param {number|string} [req.body.subject_area_id] - ID lĩnh vực chính (alternative)
 * @param {Array<number|string>} [req.body.subject_category_ids] - Danh sách ID chuyên ngành
 * @param {Array<number|string>} [req.body.journal_ids] - Danh sách ID tạp chí
 * @param {Object} res - Express response object
 * @returns {Promise<Object>} JSON response chứa thông tin dự án vừa tạo
 */
export const createProject = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const {
      title,
      subject_area,
      subject_area_id,
      subject_category_ids = [],
      journal_ids = [],
      keywords = [],
      keyword_ids = [],
    } = req.body;

    // Hỗ trợ cả hai cách đặt tên trường
    const finalSubjectArea =
      subject_area !== undefined ? subject_area : subject_area_id;

    const newProject = await projectServiceRef.createProject({
      userId,
      title: title.trim(),
      subject_area: finalSubjectArea,
      subject_category_ids,
      journal_ids,
      keywords,
      keyword_ids,
    });

    createLog({
      userId: userId,
      userRole: req.user.role,
      action: 'CREATE',
      entityTable: 'Project',
      entityId: newProject.project_id,
      message: `Tạo mới dự án nghiên cứu: ${newProject.title}`,
      metadata: { ip: req.ip }
    });

    return res.code(201).send({
      success: true,
      code: "SUCCESS_CREATE_PROJECT",
      message: "Tạo dự án thành công",
      data: newProject,
    });
  } catch (error) {
    logger.error("Lỗi khi tạo dự án mới:", error);

    if (
      error.message &&
      (error.message.includes("không tồn tại") ||
        error.message.includes("chưa tồn tại"))
    ) {
      return res.code(400).send({
        success: false,
        code: "PROJECT_CREATION_FAILED",
        message: error.message,
      });
    }

    logger.error("[Project Controller] Lỗi khi tạo dự án:", error);
    return res.code(500).send({
      success: false,
      code: "INTERNAL_SERVER_ERROR",
      message: "Có lỗi xảy ra ở server khi tạo dự án",
    });
  }
};

/**
 * API Cập nhật thông tin dự án và các mối quan hệ liên kết của nó
 * @param {Object} req - Express request object
 * @param {Object} req.params - Các tham số trên URL
 * @param {string} req.params.id - ID của dự án cần cập nhật
 * @param {Object} req.user - Thông tin người dùng đã xác thực
 * @param {string} req.user.user_id - ID người dùng
 * @param {Object} req.body - Dữ liệu cập nhật dự án
 * @param {string} [req.body.title] - Tiêu đề mới của dự án
 * @param {number|string} [req.body.subject_area] - ID mới của lĩnh vực chính
 * @param {number|string} [req.body.subject_area_id] - ID mới của lĩnh vực chính (alternative)
 * @param {Array<number|string>} [req.body.subject_category_ids] - Danh sách ID chuyên ngành mới
 * @param {Array<number|string>} [req.body.journal_ids] - Danh sách ID tạp chí mới
 * @param {Object} res - Express response object
 * @returns {Promise<Object>} JSON response thông báo kết quả cập nhật
 */
export const updateProject = async (req, res) => {
  try {
    const projectId = req.params.id;
    const userId = req.user.user_id;
    const {
      title,
      subject_area,
      subject_area_id,
      subject_category_ids,
      journal_ids,
    } = req.body;

    const finalSubjectArea =
      subject_area !== undefined ? subject_area : subject_area_id;

    const updated = await projectServiceRef.updateProject(projectId, userId, {
      title: title ? title.trim() : undefined,
      subject_area: finalSubjectArea,
      subject_category_ids,
      journal_ids,
    });

    if (!updated) {
      return res.code(404).send({
        success: false,
        code: "PROJECT_NOT_FOUND_OR_ACCESS_DENIED",
        message:
          "Không tìm thấy dự án hoặc bạn không có quyền truy cập dự án này",
      });
    }

    createLog({
      userId: userId,
      userRole: req.user.role,
      action: 'UPDATE',
      entityTable: 'Project',
      entityId: projectId,
      message: `Cập nhật dự án nghiên cứu: ${title || projectId}`,
      metadata: { ip: req.ip }
    });

    await cacheService.del(`project:${projectId}:analytics`);

    return res.code(200).send({
      success: true,
      code: "SUCCESS_UPDATE_PROJECT",
      message: "Cập nhật dự án thành công",
    });
  } catch (error) {
    if (error.statusCode) {
      return res.code(error.statusCode).send({
        success: false,
        code: error.code || "UPDATE_PROJECT_FAILED",
        message: error.message,
      });
    }

    if (
      error.message &&
      (error.message.includes("không tồn tại") ||
        error.message.includes("chưa tồn tại"))
    ) {
      return res.code(400).send({
        success: false,
        code: "PROJECT_NOT_FOUND_OR_ACCESS_DENIED",
        message: error.message,
      });
    }

    logger.error("[Project Controller] Lỗi khi cập nhật dự án:", error);
    return res.code(500).send({
      success: false,
      code: "INTERNAL_SERVER_ERROR",
      message: "Có lỗi xảy ra ở server khi cập nhật dự án",
    });
  }
};

/**
 * API Xóa dự án khoa học (xóa mềm - cập nhật trạng thái thành DELETED)
 * @param {Object} req - Fastify request object
 * @param {Object} req.params - Các tham số trên URL
 * @param {string} req.params.id - ID của dự án cần xóa
 * @param {Object} req.user - Thông tin người dùng đã xác thực
 * @param {string} req.user.user_id - ID người dùng
 * @param {Object} res - Fastify reply object
 * @returns {Promise<Object>} JSON response thông báo kết quả xóa dự án
 */
export const deleteProject = async (req, res) => {
  try {
    const projectId = req.params.id;
    const userId = req.user.user_id;

    const previousStatus = await projectServiceRef.deleteProject(projectId, userId);

    createLog({
      userId: userId,
      userRole: req.user.role,
      action: 'DELETE',
      entityTable: 'Project',
      entityId: projectId,
      message: `Xóa mềm dự án nghiên cứu có ID: ${projectId}`,
      oldData: { status: previousStatus },
      newData: { status: 'DELETED' },
      metadata: { ip: req.ip }
    });

    await cacheService.del(`project:${projectId}:analytics`);

    return res.code(200).send({
      success: true,
      code: "SUCCESS_DELETE_PROJECT",
      message: "Xóa dự án thành công",
    });
  } catch (error) {
    if (error.statusCode) {
      return res.code(error.statusCode).send({
        success: false,
        code: error.code || "DELETE_PROJECT_FAILED",
        message: error.message,
      });
    }
    logger.error("[Project Controller] Lỗi khi xóa dự án:", error);
    return res.code(500).send({
      success: false,
      code: "INTERNAL_SERVER_ERROR",
      message: error.message || "Có lỗi xảy ra ở server khi xóa dự án",
    });
  }
};

/**
 * Khôi phục dự án đã bị xóa mềm
 * @param {Object} req - Fastify request object
 * @param {Object} req.params - Các tham số trên URL
 * @param {string} req.params.id - ID của dự án cần khôi phục
 * @param {Object} req.user - Thông tin người dùng đã xác thực
 * @param {string} req.user.user_id - ID người dùng
 * @param {Object} res - Fastify reply object
 * @returns {Promise<Object>} JSON response thông báo kết quả khôi phục dự án
 */
export const restoreProject = async (req, res) => {
  try {
    const projectId = req.params.id;
    const userId = req.user.user_id;

    const restoredStatus = await projectServiceRef.restoreProject(projectId, userId);

    createLog({
      userId: userId,
      userRole: req.user.role,
      action: 'UPDATE',
      entityTable: 'Project',
      entityId: projectId,
      message: `Khôi phục dự án nghiên cứu có ID: ${projectId}`,
      oldData: { status: 'DELETED' },
      newData: { status: restoredStatus },
      metadata: { ip: req.ip }
    });

    await cacheService.del(`project:${projectId}:analytics`);

    return res.code(200).send({
      success: true,
      code: "SUCCESS_RESTORE_PROJECT",
      message: "Khôi phục dự án thành công",
      data: { status: restoredStatus }
    });
  } catch (error) {
    if (error.statusCode) {
      return res.code(error.statusCode).send({
        success: false,
        code: error.code || "RESTORE_PROJECT_FAILED",
        message: error.message,
      });
    }
    logger.error("[Project Controller] Lỗi khi khôi phục dự án:", error);
    return res.code(500).send({
      success: false,
      code: "INTERNAL_SERVER_ERROR",
      message: error.message || "Có lỗi xảy ra ở server khi khôi phục dự án",
    });
  }
};

/**
 * Controller xử lý yêu cầu lấy danh sách bài viết liên quan của một dự án.
 * * - Hàm này sẽ bóc tách `projectId` từ URL params và `limit` từ query string.
 * - Sau đó tự động phối hợp các dịch vụ để lấy danh sách các Journal IDs và Category IDs thuộc dự án,
 * rồi truy vấn ra các bài viết liên quan mới nhất.
 *
 * @async
 * @param {import('express').Request} req - Đối tượng Request của Express.
 * @param {Object} req.params - Các tham số định tuyến trên URL.
 * @param {string} req.params.id - ID của dự án (sẽ được ép kiểu sang số nguyên).
 * @param {Object} req.query - Các tham số truy vấn (Query String) trên URL.
 * @param {string} [req.query.limit] - Số lượng bài viết tối đa muốn lấy (mặc định hệ thống tự nhận là 5).
 * * @param {import('express').Response} res - Đối tượng Response của Express dùng để trả về dữ liệu cho Client.
 * * @returns {Promise<import('express').Response>} Trả về phản hồi HTTP JSON:
 * - **200 (OK):** Lấy danh sách bài viết thành công kèm theo mảng dữ liệu.
 * - **400 (Bad Request):** ID dự án hoặc giá trị limit không đúng định dạng số nguyên dương.
 * - **500 (Internal Server Error):** Lỗi hệ thống hoặc lỗi phát sinh tại máy chủ Database.
 */
export const getRelatedArticles = async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    let limit = Number(req.query.limit);

    const journalIds =
      await projectServiceRef.getJournalIdsByProjectId(projectId);
    const categoryIds =
      await projectServiceRef.getCategoryIdsByProjectId(projectId);

    const relatedArticles = await projectServiceRef.getRelatedArticles(
      journalIds,
      categoryIds,
      { limit },
    );

    return res.code(200).send({
      success: true,
      code: "SUCCESS_GET_RELATED_ARTICLES",
      message: "Lấy bài viết liên quan thành công",
      data: relatedArticles,
    });
  } catch (error) {
    logger.error("Lỗi khi lấy bài viết liên quan:", error);
    return res.code(500).send({
      success: false,
      code: "INTERNAL_SERVER_ERROR",
      message: "Có lỗi xảy ra ở server khi lấy bài viết liên quan",
    });
  }
};

/**
 * API Lấy dữ liệu tổng quan và biểu đồ của một dự án.
 * User ID được lấy từ access token, không nhận từ client.
 *
 * @async
 * @param {Object} req - Express request object
 * @param {Object} req.params - Các tham số trên URL
 * @param {string} req.params.id - ID của dự án cần lấy overview
 * @param {Object} req.user - Thông tin người dùng đã xác thực
 * @param {string} req.user.user_id - ID người dùng
 * @param {Object} res - Express response object
 * @returns {Promise<Object>} JSON response chứa dữ liệu overview
 */
export const getProjectOverview = async (req, res) => {
  try {
    const projectId = req.params.id;
    const userId = req.user.user_id;

    if (!/^\d+$/.test(projectId) || Number(projectId) <= 0) {
      return res.code(400).send({
        success: false,
        code: "INVALID_PROJECT_ID",
        message: 'ID dự án không hợp lệ'
      });
    }

    const overviewData = await projectServiceRef.getProjectOverview(projectId, userId);

    if (!overviewData) {
      return res.code(403).send({
        success: false,
        code: "FORBIDDEN",
        message: "Bạn không có quyền truy cập project này",
      });
    }

    const hasData = overviewData.summary.totalArticles > 0
      || overviewData.summary.totalKeywords > 0
      || overviewData.summary.totalJournals > 0;

    return res.code(200).send({
      success: true,
      message: hasData
        ? "Project overview fetched successfully"
        : "No overview data found",
      data: overviewData,
    });
  } catch (error) {
    logger.error(
      "[Project Controller] Lỗi khi lấy dữ liệu tổng quan dự án:",
      error,
    );
    return res.code(500).send({
      success: false,
      code: "INTERNAL_SERVER_ERROR",
      message: "Có lỗi xảy ra khi lấy dữ liệu tổng quan dự án",
    });
  }
};

/**
 * API Lấy dữ liệu phân tích/thống kê của một dự án (Trending Charts)
 *
 * @async
 * @param {Object} req - Express request object
 * @param {Object} req.params - Các tham số trên URL
 * @param {string} req.params.id - ID của dự án cần phân tích
 * @param {Object} req.user - Thông tin người dùng đã xác thực
 * @param {string} req.user.user_id - ID người dùng
 * @param {Object} res - Express response object
 * @returns {Promise<Object>} JSON response chứa dữ liệu phân tích dự án
 */
export const getProjectAnalytics = async (req, res) => {
  try {
    const projectId = req.params.id;
    const userId = req.user.user_id;

    const cacheKey = `project:${projectId}:analytics`;
    const cachedData = await cacheService.get(cacheKey);
    if (cachedData) {
      return res.code(200).send({
        success: true,
        code: "SUCCESS_GET_PROJECT_ANALYTICS",
        message: "Lấy dữ liệu phân tích dự án thành công (từ cache)",
        data: cachedData,
      });
    }

    const analyticsData = await projectServiceRef.getProjectAnalytics(
      projectId,
      userId,
    );
    if (!analyticsData) {
      return res.code(404).send({
        success: false,
        code: "PROJECT_NOT_FOUND_OR_ACCESS_DENIED",
        message:
          "Không tìm thấy dự án hoặc bạn không có quyền truy cập dự án này",
      });
    }

    await cacheService.set(cacheKey, analyticsData);

    return res.code(200).send({
      success: true,
      code: "SUCCESS_GET_PROJECT_ANALYTICS",
      message: "Lấy dữ liệu phân tích dự án thành công",
      data: analyticsData,
    });
  } catch (error) {
    logger.error(
      "[Project Controller] Lỗi khi lấy dữ liệu phân tích dự án:",
      error,
    );
    return res.code(500).send({
      success: false,
      code: "INTERNAL_SERVER_ERROR",
      message: "Có lỗi xảy ra khi lấy dữ liệu phân tích dự án",
    });
  }
};

/**
 * API Kích hoạt dự án (trừ coin)
 * Nhận vào projectId, coinAmount để trừ và chuyển trạng thái sang ACTIVE
 *
 * @async
 * @param {Object} req
 * @param {Object} res
 */
export const activateProject = async (req, res) => {
  try {
    const projectId = req.params.id;
    const userId = req.user.user_id;
    const { coinAmount } = req.body;

    if (!coinAmount || isNaN(coinAmount) || coinAmount <= 0) {
      return res.code(400).send({
        success: false,
        code: "INVALID_COIN_AMOUNT",
        message: "Số coin truyền vào không hợp lệ",
      });
    }

    // Kiểm tra dự án có tồn tại và thuộc về user không
    const project = await projectServiceRef.getProjectById(projectId, userId);
    if (!project) {
      return res.code(404).send({
        success: false,
        code: "PROJECT_NOT_FOUND_OR_ACCESS_DENIED",
        message: "Không tìm thấy dự án hoặc bạn không có quyền",
      });
    }

    if (project.status === "DELETED") {
      return res.code(400).send({
        success: false,
        code: "PROJECT_ALREADY_DELETED",
        message: "Không thể kích hoạt dự án đã bị xóa",
      });
    }

    if (project.status === "ACTIVE") {
      return res.code(400).send({
        success: false,
        code: "PROJECT_ALREADY_ACTIVE",
        message: "Dự án đã được kích hoạt trước đó",
      });
    }

    // Tiến hành trừ coin
    await spendCoins({
      userId,
      amount: Number(coinAmount),
      description: `Kích hoạt dự án: ${project.title || projectId}`,
    });

    // Cập nhật trạng thái dự án
    const updated = await projectServiceRef.updateProjectStatus(projectId, userId, 'ACTIVE');
    if (!updated) {
      throw new Error("Không thể cập nhật trạng thái project");
    }

    createLog({
      userId: userId,
      userRole: req.user.role,
      action: 'UPDATE',
      entityTable: 'Project',
      entityId: projectId,
      message: `Kích hoạt dự án ${project.title || projectId} (Trừ ${coinAmount} coin)`,
      metadata: { ip: req.ip, coinAmount }
    });

    await cacheService.del(`project:${projectId}:analytics`);

    return res.code(200).send({
      success: true,
      code: "SUCCESS_ACTIVATE_PROJECT",
      message: "Kích hoạt dự án thành công",
    });

  } catch (error) {
    if (error.code === 'INSUFFICIENT_BALANCE' || (error.status && error.status === 409)) {
       return res.code(400).send({
         success: false,
         code: "INSUFFICIENT_BALANCE",
         message: "Số dư coin không đủ để thực hiện giao dịch",
       });
    }

    logger.error("[Project Controller] Lỗi khi kích hoạt dự án:", error);
    return res.code(500).send({
      success: false,
      code: "INTERNAL_SERVER_ERROR",
      message: "Có lỗi xảy ra khi kích hoạt dự án",
    });
  }
};

