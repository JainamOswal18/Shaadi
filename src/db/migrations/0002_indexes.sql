create index if not exists faces_embedding_hnsw
  on faces using hnsw (embedding vector_cosine_ops);
create index if not exists photos_status_created on photos(status, created_at desc);
create index if not exists search_sessions_ip_created on search_sessions(ip, created_at desc);
