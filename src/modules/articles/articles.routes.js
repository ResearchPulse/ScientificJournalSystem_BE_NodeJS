import { 
  getArticle, 
  getArticleFilterOptions,
  getArticleById, 
  createArticle, 
  updateArticle, 
  deleteArticle, 
  restoreArticle 
} from './articles.controller.js';
import { verifyTokenFastify } from '../auth/auth.middleware.js';
import { 
  getArticlesSchema, 
  getArticleFilterOptionsSchema,
  getArticleByIdSchema, 
  createArticleSchema, 
  updateArticleSchema, 
  deleteArticleSchema, 
  restoreArticleSchema 
} from './articles.schema.js';

/**
 * Articles plugin for Fastify
 * @param {import('fastify').FastifyInstance} fastify 
 * @param {Object} options 
 */
export default async function articlesRoutes(fastify, options) {
  
  // Route GET tổng hợp:
  // Chúng ta định nghĩa route public, và nếu có query 'keywords' thì check JWT thủ công bên trong hoặc thêm preHandler động
  // Fastify có thể chạy custom preHandler
  fastify.get('/', { 
    schema: getArticlesSchema,
    preHandler: async (request, reply) => {
      // Nếu có keywords thì bắt buộc phải có token hợp lệ
      if (request.query.keywords !== undefined) {
        await verifyTokenFastify(request, reply);
      }
    }
  }, getArticle);

  fastify.get('/filter-options', { schema: getArticleFilterOptionsSchema }, getArticleFilterOptions);

  fastify.get('/:id', { schema: getArticleByIdSchema }, getArticleById);

  fastify.post('/', { 
    preHandler: [verifyTokenFastify],
    schema: createArticleSchema 
  }, createArticle);

  fastify.put('/:id', { 
    preHandler: [verifyTokenFastify],
    schema: updateArticleSchema 
  }, updateArticle);

  fastify.delete('/:id', { 
    preHandler: [verifyTokenFastify],
    schema: deleteArticleSchema 
  }, deleteArticle);

  fastify.patch('/:id/restore', { 
    preHandler: [verifyTokenFastify],
    schema: restoreArticleSchema 
  }, restoreArticle);
}
