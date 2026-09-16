export const getArticlesSchema = {
  tags: ['Articles'],
  summary: 'Lấy danh sách hoặc tìm kiếm bài báo tổng hợp',
  description: 'Nếu KHÔNG truyền tham số `keywords`: trả về danh sách bài báo công khai, hỗ trợ `search`, phân trang và sắp xếp. Nếu CÓ truyền tham số `keywords`: API chuyển sang chế độ tìm kiếm nâng cao theo từ khóa chuyên biệt (yêu cầu xác thực Bearer Token).',
  querystring: {
    type: 'object',
    properties: {
      keywords: { type: 'string', description: 'Danh sách từ khóa cách nhau bởi dấu phẩy.' },
      page: { 
        anyOf: [
          { type: 'integer' },
          { type: 'string' }
        ], 
        default: 1 
      },
      limit: { 
        anyOf: [
          { type: 'integer' },
          { type: 'string' }
        ], 
        default: 10 
      },
      search: { type: 'string' },
      sortBy: { type: 'string', enum: ['article_id', 'title', 'publication_year', 'created_at', 'doi'], default: 'created_at' },
      sortOrder: { type: 'string', enum: ['asc', 'desc', 'ASC', 'DESC'], default: 'DESC' },
      publication_year: { type: 'integer' },
      year: { type: 'integer' },
      journal_id: { type: 'integer' },
      journal: { type: 'integer' },
      topic_id: { type: 'integer' },
      topic: { type: 'integer' },
      volume_id: { type: 'integer' },
      issue_id: { type: 'integer' },
      is_open_access: { type: 'string' },
      access: { type: 'string' },
      country_id: { type: 'integer' },
      country: { type: 'integer' }
    }
  }
};

export const getArticleFilterOptionsSchema = {
  tags: ['Articles'],
  summary: 'Lấy các tùy chọn bộ lọc cho bài báo (năm thực tế, top journals, top topics)',
  description: 'Trả về danh sách các năm xuất bản thực tế từ cơ sở dữ liệu và top tạp chí, chủ đề phổ biến để phục vụ bộ lọc bài báo.',
};

export const getArticleByIdSchema = {
  tags: ['Articles'],
  summary: 'Lấy chi tiết bài báo theo ID',
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'integer' }
    }
  }
};

export const createArticleSchema = {
  tags: ['Articles'],
  summary: 'Tạo mới một bài báo',
  body: {
    type: 'object',
    required: ['title', 'publication_year'],
    properties: {
      title: { type: 'string', minLength: 1 },
      abstract: { type: 'string' },
      publication_year: { type: 'integer' },
      issue_id: { type: 'integer' },
      doi: { type: 'string' },
      primary_topic: { type: 'integer' },
      sub_topic: {
        type: 'array',
        items: {
          anyOf: [{ type: 'string' }, { type: 'integer' }]
        }
      },
      authors: {
        type: 'array',
        items: { type: 'integer' }
      },
      keywords: {
        anyOf: [
          {
            type: 'array',
            items: { type: 'string' }
          },
          {
            type: 'object',
            additionalProperties: { type: 'number' }
          }
        ]
      }
    }
  }
};

export const updateArticleSchema = {
  tags: ['Articles'],
  summary: 'Cập nhật thông tin bài báo theo ID',
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'integer' }
    }
  },
  body: {
    type: 'object',
    properties: {
      title: { type: 'string', minLength: 1 },
      abstract: { type: 'string' },
      publication_year: { type: 'integer' },
      issue_id: { type: 'integer' },
      doi: { type: 'string' },
      primary_topic: { type: 'integer' },
      sub_topic: {
        type: 'array',
        items: {
          anyOf: [{ type: 'string' }, { type: 'integer' }]
        }
      },
      authors: {
        type: 'array',
        items: { 
          anyOf: [{ type: 'integer' }, { type: 'object' }] 
        }
      },
      keywords: {
        anyOf: [
          {
            type: 'array',
            items: { type: 'string' }
          },
          {
            type: 'object',
            additionalProperties: { type: 'number' }
          }
        ]
      }
    }
  }
};

export const deleteArticleSchema = {
  tags: ['Articles'],
  summary: 'Xóa mềm (soft delete) bài báo',
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'integer' }
    }
  }
};

export const restoreArticleSchema = {
  tags: ['Articles'],
  summary: 'Khôi phục bài báo đã bị xóa mềm',
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'integer' }
    }
  }
};
