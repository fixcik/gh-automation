import pino from 'pino';

const isDevelopment = process.env.NODE_ENV !== 'production';

export const createLogger = (service: string, version = '0.0.1') => {
  return pino({
    name: service,
    level: process.env.LOG_LEVEL || 'info',
    base: {
      service,
      version,
      environment: process.env.NODE_ENV || 'development',
    },
    ...(isDevelopment && {
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      },
    }),
  });
};

export type Logger = ReturnType<typeof createLogger>;
