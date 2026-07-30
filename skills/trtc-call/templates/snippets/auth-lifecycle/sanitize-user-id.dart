// General-purpose normalizer: strips characters illegal in TRTC userId.
String safeUserIdFrom(String raw) =>
    raw.replaceAll(RegExp(r'[^a-zA-Z0-9_\-]'), '_');

// Supabase UUID normalizer: UUID v4 is 36 chars (hyphens included), which
// exceeds TRTC's 32-byte limit. Stripping hyphens yields 32-char hex, fully
// within the allowed charset ([0-9a-f]{32}) and always exactly 32 bytes.
// Use this as normalizeUserId when the project uses supabase_flutter auth.
String supabaseUserIdToTrtc(String uuid) => uuid.replaceAll('-', '');
