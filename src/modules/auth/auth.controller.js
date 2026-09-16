import { 
  loginUser, 
  registerUser, 
  verifyUserEmail, 
  requestPasswordReset, 
  resetPassword as resetPasswordService, 
  loginWithGoogle as loginWithGoogleService,
  refreshTokenService
} from './auth.service.js';

const getCookieDomain = () => {
  const domain = process.env.COOKIE_DOMAIN;
  if (!domain || domain === 'localhost' || domain === '127.0.0.1') return undefined;
  return domain;
};

export const login = async (request, reply) => {
  try {
    const { email, password, remember } = request.body;
    const { token, refreshToken, user } = await loginUser(email, password);
    const domain = getCookieDomain();

    reply.setCookie('access_token', token, {
      path: '/',
      domain,
      httpOnly: true,
      secure: true,
      sameSite: 'none', // Cho phép cross-site request qua HTTPS
      maxAge: parseInt(process.env.COOKIE_ACCESS_MAX_AGE || 3600000, 10) / 1000 // 1 hour default
    });

    if (remember) {
      reply.setCookie('refresh_token', refreshToken, {
        path: '/',
        domain,
        httpOnly: true,
        secure: true,
        sameSite: 'none',
        maxAge: parseInt(process.env.COOKIE_REFRESH_MAX_AGE || 2592000000, 10) / 1000 // 30 days default
      });
    } else {
      reply.setCookie('refresh_token', refreshToken, {
        path: '/',
        domain,
        httpOnly: true,
        secure: true,
        sameSite: 'none'
        // no maxAge = session cookie
      });
    }

    return reply.send({
      success: true,
      message: 'Đăng nhập thành công',
      data: {
        token,
        refresh_token: refreshToken,
        remember: Boolean(remember),
        user: {
          user_id: user.user_id,
          email: user.email,
          role: user.role,
          status: user.status
        }
      }
    });
  } catch (error) {
    return reply.code(401).send({
      success: false,
      message: error.message
    });
  }
};

export const register = async (request, reply) => {
  console.log('[Register API] Started');
  try {
    const { email, password, first_name, last_name, date_of_birth, gender, role } = request.body;
    console.log('[Register API] Extracted body:', { email, first_name, last_name, role });
    
    console.log('[Register API] Calling registerUser...');
    const user = await registerUser(email, password, first_name, last_name, date_of_birth, gender, role);
    console.log('[Register API] registerUser returned:', user?.user_id);

    return reply.code(201).send({
      success: true,
      message: 'Đăng ký thành công',
      data: {
        user_id: user.user_id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name
      }
    });
  } catch (error) {
    console.error('[Register API] Error:', error);
    return reply.code(400).send({
      success: false,
      message: error.message
    });
  }
};

export const verifyAccount = async (request, reply) => {
  try {
    const { token } = request.query || {};
    const result = await verifyUserEmail(token);
    return reply.send({
      success: true,
      message: result.message || 'Kích hoạt tài khoản thành công'
    });
  } catch (error) {
    return reply.code(400).send({
      success: false,
      message: error.message || 'Kích hoạt tài khoản thất bại'
    });
  }
};

export const refreshToken = async (request, reply) => {
  try {
    const tokenFromCookie = request.cookies?.refresh_token;
    const tokenFromHeader = request.headers['x-refresh-token'];
    const tokenFromBody = request.body?.refresh_token;
    const tokenFromQuery = request.query?.refresh_token;
    const incomingRefreshToken = tokenFromCookie || tokenFromHeader || tokenFromBody || tokenFromQuery;

    if (!incomingRefreshToken) {
      return reply.code(401).send({
        success: false,
        code: 'REFRESH_TOKEN_MISSING',
        message: 'Không tìm thấy refresh token'
      });
    }

    const { token, refreshToken: newRefreshToken, user } = await refreshTokenService(incomingRefreshToken);
    const domain = getCookieDomain();

    reply.setCookie('access_token', token, {
      path: '/',
      domain,
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      maxAge: parseInt(process.env.COOKIE_ACCESS_MAX_AGE || 3600000, 10) / 1000
    });

    reply.setCookie('refresh_token', newRefreshToken, {
      path: '/',
      domain,
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      maxAge: parseInt(process.env.COOKIE_REFRESH_MAX_AGE || 2592000000, 10) / 1000
    });

    return reply.send({
      success: true,
      message: 'Cấp lại access token thành công',
      data: {
        token,
        refresh_token: newRefreshToken,
        user: {
          user_id: user.user_id,
          email: user.email,
          role: user.role,
          status: user.status
        }
      }
    });
  } catch (error) {
    const domain = getCookieDomain();
    reply.clearCookie('access_token', { domain, path: '/', secure: true, sameSite: 'none' });
    reply.clearCookie('refresh_token', { domain, path: '/', secure: true, sameSite: 'none' });
    return reply.code(401).send({
      success: false,
      code: 'REFRESH_TOKEN_INVALID',
      message: error.message || 'Refresh token không hợp lệ hoặc đã hết hạn'
    });
  }
};

export const logout = async (request, reply) => {
  const domain = getCookieDomain();
  reply.clearCookie('access_token', { domain, path: '/', secure: true, sameSite: 'none' });
  reply.clearCookie('refresh_token', { domain, path: '/', secure: true, sameSite: 'none' });
  return reply.send({
    success: true,
    message: 'Đăng xuất thành công'
  });
};

export const checkAuth = async (request, reply) => {
  return reply.send({
    success: true,
    authenticated: true,
    user: request.user
  });
};

export const forgotPassword = async (request, reply) => {
  try {
    const { email } = request.body || {};
    const result = await requestPasswordReset(email);
    return reply.send(result);
  } catch (error) {
    return reply.code(error.statusCode || 400).send({
      success: false,
      message: error.message || 'Có lỗi xảy ra khi xử lý yêu cầu quên mật khẩu'
    });
  }
};

export const resetPassword = async (request, reply) => {
  try {
    const { token, new_password } = request.body || {};
    const result = await resetPasswordService(token, new_password);
    return reply.send(result);
  } catch (error) {
    return reply.code(error.statusCode || 400).send({
      success: false,
      message: error.message || 'Đặt lại mật khẩu thất bại'
    });
  }
};

export const googleLogin = async (request, reply) => {
  try {
    const { code } = request.body || {};
    if (!code) {
      return reply.code(400).send({ success: false, message: 'Thiếu authorization code' });
    }

    const { token, refreshToken, user, isNewUser } = await loginWithGoogleService(code);

    const isProduction = process.env.NODE_ENV === 'production';
    const cookieOpts = {
      path: '/',
      domain: getCookieDomain(),
      httpOnly: true,
      secure: true,
      sameSite: 'none',
    };

    reply.setCookie('access_token', token, {
      ...cookieOpts,
      maxAge: parseInt(process.env.COOKIE_ACCESS_MAX_AGE || 3600000, 10) / 1000,
    });

    reply.setCookie('refresh_token', refreshToken, {
      ...cookieOpts,
      maxAge: parseInt(process.env.COOKIE_REFRESH_MAX_AGE || 2592000000, 10) / 1000,
    });

    return reply.send({
      success: true,
      code: 'GOOGLE_LOGIN_SUCCESS',
      message: isNewUser ? 'Đăng ký và đăng nhập thành công' : 'Đăng nhập thành công',
      data: {
        token,
        refresh_token: refreshToken,
        user: {
          user_id: user.user_id,
          email: user.email,
          role: user.role,
          status: user.status,
        },
      },
    });
  } catch (error) {
    return reply.code(401).send({
      success: false,
      message: error.message || 'Đăng nhập Google thất bại',
    });
  }
};
