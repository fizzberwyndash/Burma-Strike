export interface ServerConfiguration {
  port: number; host: string; allowedOrigins: string[]; reconnectSeconds: number; maxRooms: number;
}
const integer = (value: string | undefined, fallback: number, min: number, max: number) => {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error('Invalid numeric server environment configuration');
  return parsed;
};
export function readConfiguration(env: NodeJS.ProcessEnv = process.env): ServerConfiguration {
  const allowedOrigins = (env.ALLOWED_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173').split(',').map(s => s.trim()).filter(Boolean);
  if (allowedOrigins.length === 0 || allowedOrigins.some(origin => origin === '*' || !/^https?:\/\/[^/]+$/.test(origin))) {
    throw new Error('ALLOWED_ORIGINS must contain explicit HTTP(S) origins, without paths or wildcards');
  }
  return { port:integer(env.PORT,2567,1,65535), host:env.HOST || '0.0.0.0', allowedOrigins,
    reconnectSeconds:integer(env.RECONNECT_SECONDS,30,5,120), maxRooms:integer(env.MAX_ROOMS,100,1,1000) };
}
