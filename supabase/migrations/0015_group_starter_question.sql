-- Drops the LLM-invented "suggested place" concept — it was pure creative
-- text generation (no real venue/reservation data behind it, see
-- lib/matching.ts's buildMatchPrompt), and produced nonsensical results
-- (e.g. a coffee-shop name suggested for a dinner slot). Where to actually
-- meet is left to the group to decide themselves in chat.
--
-- In its place: an icebreaker/conversation-starter question, grounded in
-- the table's shared interests — same LLM call, same tool-schema slot,
-- just asking for something the app can actually make good on.
alter table groups rename column suggested_place to starter_question;
