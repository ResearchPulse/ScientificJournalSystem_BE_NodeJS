export const getAuthorAreasBreakdownSchema = {
  schema: {
    tags: ["Author"],
    summary: "Lấy phân tích lĩnh vực nghiên cứu của tác giả theo ID",
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

export const getAuthorArticlesSchema = {
  schema: {
    tags: ["Author"],
    summary: "Lấy danh sách bài viết của tác giả theo ID",
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
        limit: { type: "integer", minimum: 1, default: 10 },
        page: { type: "integer", minimum: 1, default: 1 },
      },
    },
  },
};

export const getAuthorLeaderboardSchema = {
  schema: {
    tags: ["Author"],
    summary: "Lấy bảng xếp hạng tác giả",
    security: [{ bearerAuth: [] }],
    querystring: {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, default: 10 },
        page: { type: "integer", minimum: 1, default: 1 },
        subject_area: { type: "string" },
        period: { type: "string" },
      },
    },
  },
};

export const getAllAuthorsSchema = {
  schema: {
    tags: ["Author"],
    summary: "Lấy danh sách tác giả",
    querystring: {
      type: "object",
      properties: {
        page: { type: "integer", minimum: 1, default: 1 },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 10 },
        search: { type: "string" },
        sort: { type: "string" },
        subject_area: { type: "string" },
        subject_area_id: { type: "string" },
        country: { type: "string" },
      },
    },
  },
};

export const createAuthorSchema = {
  schema: {
    tags: ["Author"],
    summary: "Tạo mới tác giả",
    security: [{ bearerAuth: [] }],
    body: {
      type: "object",
      required: ["display_name"],
      properties: {
        display_name: { type: "string", minLength: 2, maxLength: 255 },
        orcid: { type: "string", nullable: true },
        url_image: { type: "string", nullable: true },
        homepage_url: { type: "string", nullable: true },
        works_count: { type: "integer", minimum: 0, nullable: true },
        cited_by_count: { type: "integer", minimum: 0, nullable: true },
        h_index: { type: "integer", minimum: 0, nullable: true },
        i10_index: { type: "integer", minimum: 0, nullable: true },
        last_known_institution: { type: "string", nullable: true },
        last_known_institution_id: { type: "string", nullable: true },
      },
    },
  },
};

export const restoreAuthorSchema = {
  schema: {
    tags: ["Author"],
    summary: "Khôi phục tác giả đã bị xóa mềm",
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

export const getAuthorByIdSchema = {
  schema: {
    tags: ["Author"],
    summary: "Lấy thông tin tác giả theo ID",
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

export const updateAuthorSchema = {
  schema: {
    tags: ["Author"],
    summary: "Cập nhật thông tin tác giả",
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
      minProperties: 1,
      properties: {
        display_name: { type: "string", minLength: 2, maxLength: 255 },
        orcid: { type: "string", nullable: true },
        url_image: { type: "string", nullable: true },
        homepage_url: { type: "string", nullable: true },
        works_count: { type: "integer", minimum: 0, nullable: true },
        cited_by_count: { type: "integer", minimum: 0, nullable: true },
        h_index: { type: "integer", minimum: 0, nullable: true },
        i10_index: { type: "integer", minimum: 0, nullable: true },
        last_known_institution: { type: "string", nullable: true },
        last_known_institution_id: { type: "string", nullable: true },
      },
    },
  },
};

export const deleteAuthorSchema = {
  schema: {
    tags: ["Author"],
    summary: "Xóa mềm tác giả",
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
