// AI 助理的 API：狀態與提問。對話內容不存伺服器（每次由前端帶完整的文字歷史來），只在操作紀錄留「誰問了什麼」。
const express = require('express');
const { audit } = require('../db');
const { requireStaff } = require('../auth');
const { canSee } = require('../finance');
const { toolsFor, execTool, runAgent, systemPrompt, aiConfig } = require('../ai');

const router = express.Router();

// 提問不是寫入資料，所以不走 requireStaff('ai') 的唯讀擋寫入邏輯，只檢查有沒有這個模組
function requireAi(req, res, next) {
  if (!canSee(req, 'ai')) return res.status(403).json({ error: '無此模組使用權限' });
  next();
}

const modulesOf = req => ({ role: req.user.role, modules: req.userModules });

router.get('/ai/status', requireStaff(), requireAi, (req, res) => {
  const c = aiConfig();
  res.json({ ready: c.ready, provider: c.provider, model: c.model, tools: toolsFor(modulesOf(req)).map(t => t.name) });
});

router.post('/ai/chat', requireStaff(), requireAi, async (req, res) => {
  const cfg = aiConfig();
  if (!cfg.ready) return res.status(400).json({ error: '管理員還沒在系統設定填好 AI 助理（服務商、模型、API 金鑰）' });
  const raw = Array.isArray(req.body && req.body.messages) ? req.body.messages : [];
  const messages = raw.slice(-30)
    .filter(m => m && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string' && m.content.trim())
    .map(m => ({ role: m.role, content: m.content.slice(0, 8000) }));
  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    return res.status(400).json({ error: '請輸入問題' });
  }
  // 對話要從使用者開始（前端被截短時第一則可能是助理回覆）
  while (messages.length && messages[0].role !== 'user') messages.shift();

  const tools = toolsFor(modulesOf(req));
  const ctx = { cookie: req.headers.cookie, port: process.env.PORT || 3490 };
  const question = messages[messages.length - 1].content;
  try {
    const out = await runAgent({
      ...cfg, messages, tools, system: systemPrompt(req.user),
      exec: (name, input) => execTool(name, input, tools, ctx)
    });
    audit('staff', req.user.id, req.user.name, 'AI 助理提問', cfg.provider, question.slice(0, 200));
    res.json(out);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    console.error('AI 助理錯誤：', e);
    res.status(502).json({ error: 'AI 助理暫時無法回答，請稍後再試' });
  }
});

module.exports = router;
