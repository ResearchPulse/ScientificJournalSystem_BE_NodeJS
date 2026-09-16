export const getProjectsSchema = {
  schema: {
    tags: ["Project"],
    summary: "Lấy danh sách dự án của người dùng đang đăng nhập",
    security: [{ bearerAuth: [] }],
  },
};

export const getProjectByIdSchema = {
  schema: {
    tags: ["Project"],
    summary: "Lấy chi tiết thông tin một dự án (bao gồm Area/Category/Journal đã chọn)",
    security: [{ bearerAuth: [] }],
    params: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "integer", minimum: 1 },
      },
    },
  },
};

export const getRelatedArticlesSchema = {
  schema: {
    tags: ["Project"],
    summary: "Lấy danh sách bài viết liên quan của một dự án",
    security: [{ bearerAuth: [] }],
    params: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "integer", minimum: 1 },
      },
    },
    querystring: {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, default: 5 },
      },
    },
  },
};

export const createProjectSchema = {
  schema: {
    tags: ["Project"],
    summary: "Tạo mới một dự án",
    security: [{ bearerAuth: [] }],
    body: {
      type: "object",
      required: ["title"],
      properties: {
        title: { type: "string", minLength: 1 },
        subject_area: { type: "integer", minimum: 1 },
        subject_category_ids: { type: "array", items: { type: "integer" } },
        journal_ids: { type: "array", items: { type: "integer" } },
        keywords: { type: "array", items: { type: "string" } },
        keyword_ids: { type: "array", items: { type: "integer" } },
      },
    },
  },
};

export const updateProjectSchema = {
  schema: {
    tags: ["Project"],
    summary: "Cập nhật thông tin dự án",
    security: [{ bearerAuth: [] }],
    params: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "integer", minimum: 1 },
      },
    },
    body: {
      type: "object",
      properties: {
        title: { type: "string", minLength: 1 },
        subject_area: { type: "integer", minimum: 1 },
        subject_category_ids: { type: "array", items: { type: "integer" } },
        journal_ids: { type: "array", items: { type: "integer" } },
      },
    },
  },
};

export const deleteProjectSchema = {
  schema: {
    tags: ["Project"],
    summary: "Xóa một dự án của người dùng",
    security: [{ bearerAuth: [] }],
    params: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "integer", minimum: 1 },
      },
    },
  },
};

export const getProjectOverviewSchema = {
  schema: {
    tags: ["Project"],
    summary: "Lấy dữ liệu tổng quan và biểu đồ của một project",
    security: [{ bearerAuth: [] }],
    params: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "integer", minimum: 1 },
      },
    },
  },
};

export const getProjectAnalyticsSchema = {
  schema: {
    tags: ["Project"],
    summary: "Lấy dữ liệu phân tích/thống kê của một dự án (Trending Charts)",
    security: [{ bearerAuth: [] }],
    params: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "integer", minimum: 1 },
      },
    },
  },
};

export const restoreProjectSchema = {
  schema: {
    tags: ["Project"],
    summary: "Khôi phục dự án đã bị xóa mềm (chỉ owner)",
    security: [{ bearerAuth: [] }],
    params: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "integer", minimum: 1 },
      },
    },
  },
};

export const activateProjectSchema = {
  schema: {
    tags: ["Project"],
    summary: "Kích hoạt dự án (trừ coin)",
    security: [{ bearerAuth: [] }],
    params: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "integer", minimum: 1 },
      },
    },
    body: {
      type: "object",
      required: ["coinAmount"],
      properties: {
        coinAmount: { type: "number", minimum: 1 },
      },
    },
  },
};
