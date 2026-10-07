-- ============================================================
--  bot-whatsapp-2 — Tablas para que el bot sobreviva a los
--  reinicios de Render (respaldo durable en Supabase).
--
--  CÓMO USARLO (para que NO dé error):
--   1) En el "Editor SQL" de Supabase, BORRA TODO lo que haya
--      (toca el editor, pulsa Ctrl+A y luego Suprimir).
--   2) Pega SOLO las dos líneas que empiezan con "create table".
--   3) Pulsa el botón "Run".
--
--  ⚠️ NO copies los renglones de comentarios (los que empiezan
--  con "--"). Pega únicamente las instrucciones.
-- ============================================================

-- 1) Sesión de WhatsApp (auth de Baileys): guarda las credenciales
--    para reconectar SIN volver a escanear el QR tras un reinicio.
create table if not exists baileys_auth (id text primary key, value text, updated_at timestamptz default now());

-- 2) Conversaciones: el bot recuerda en qué iba cada cliente
--    (estado, nombre, historial) aunque Render reinicie.
create table if not exists habla_state (id text primary key, data jsonb, updated_at timestamptz default now());
