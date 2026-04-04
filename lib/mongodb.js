import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  throw new Error('환경변수 MONGODB_URI를 .env.local에 설정해주세요.');
}

/** @type {{ conn: mongoose.Connection | null, promise: Promise<mongoose.Connection> | null }} */
let cached = global._mongooseCache;

if (!cached) {
  cached = global._mongooseCache = { conn: null, promise: null };
}

export async function connectDB() {
  if (cached.conn) return cached.conn;

  if (!cached.promise) {
    cached.promise = mongoose
      .connect(MONGODB_URI, { bufferCommands: false })
      .then((m) => m.connection);
  }

  cached.conn = await cached.promise;
  return cached.conn;
}
