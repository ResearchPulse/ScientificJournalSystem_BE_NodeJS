export const getTrendingKeywordsSchema = {
  schema: {
    tags: ["Keywords"],
    summary: "Lấy Top 20 từ khóa trending của project",
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
        limit: { type: "integer", default: 20 },
        sort_by: { type: "string", enum: ["count", "score"], default: "count" },
      },
    },
  },
};

export const getWatchedKeywordArticlesSchema = {
  schema: {
    tags: ["Keywords"],
    summary: "Lấy luồng bài báo mới nhất từ các từ khóa đang theo dõi",
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
        page: { type: "integer", minimum: 1, default: 1 },
        limit: { type: "integer", minimum: 1, default: 10 },
      },
    },
  },
};

export const watchKeywordsSchema = {
  schema: {
    tags: ["Keywords"],
    summary: "Thêm mới danh sách từ khóa vào danh sách theo dõi của dự án",
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
      required: ["keyword_ids"],
      properties: {
        keyword_ids: {
          type: "array",
          items: { type: "integer", minimum: 1 },
        },
      },
    },
  },
};

export const updateWatchedKeywordsSchema = {
  schema: {
    tags: ["Keywords"],
    summary: "Cập nhật (ghi đè) danh sách từ khóa mà dự án theo dõi",
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
      required: ["keyword_ids"],
      properties: {
        keyword_ids: {
          type: "array",
          items: { type: "integer", minimum: 1 },
        },
      },
    },
  },
};

export const deleteWatchedKeywordSchema = {
  schema: {
    tags: ["Keywords"],
    summary: "Xóa một từ khóa khỏi danh sách theo dõi của dự án",
    security: [{ bearerAuth: [] }],
    params: {
      type: "object",
      required: ["id", "keywordId"],
      properties: {
        id: { type: "integer", minimum: 1 },
        keywordId: { type: "integer", minimum: 1 },
      },
    },
  },
};

export const getAllKeywordsSchema = {
  schema: {
    tags: ["Keyword Management"],
    summary: "Lấy danh sách toàn bộ hoặc tìm kiếm keywords hệ thống",
    querystring: {
      type: "object",
      properties: {
        page: { type: "integer", minimum: 1, default: 1 },
        limit: { type: "integer", minimum: 1, default: 10 },
        search: { type: "string" },
        subject_area_id: { type: ["integer", "string"] },
      },
    },
  },
};

export const createKeywordSchema = {
  schema: {
    tags: ["Keyword Management"],
    summary: "Tạo mới một keyword vào hệ thống",
    security: [{ bearerAuth: [] }],
    body: {
      type: "object",
      required: ["display_name"],
      properties: {
        display_name: { type: "string" },
      },
    },
  },
};

export const restoreKeywordSchema = {
  schema: {
    tags: ["Keyword Management"],
    summary: "Khôi phục danh mục từ khóa đã bị xóa mềm",
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

export const getArticlesByKeywordSchema = {
  schema: {
    tags: ["Keyword Management"],
    summary: "Lấy danh sách bài báo thuộc Keyword",
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
        page: { type: "integer", minimum: 1, default: 1 },
        limit: { type: "integer", minimum: 1, default: 10 },
      },
    },
  },
};

export const getKeywordByIdSchema = {
  schema: {
    tags: ["Keyword Management"],
    summary: "Lấy chi tiết thông tin từ khóa theo ID",
    params: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "integer", minimum: 1 },
      },
    },
  },
};

export const updateKeywordSchema = {
  schema: {
    tags: ["Keyword Management"],
    summary: "Cập nhật tên hiển thị của keyword theo ID",
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
      required: ["display_name"],
      properties: {
        display_name: { type: "string" },
      },
    },
  },
};

export const deleteKeywordSchema = {
  schema: {
    tags: ["Keyword Management"],
    summary: "Xóa mềm từ khóa hệ thống theo ID",
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
