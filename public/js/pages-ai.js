// AI 助理：用問的查系統資料。對話只留在這個分頁（換頁或重新整理就清掉），伺服器不存對話內容。

App.page('ai', {
  title: 'AI 助理',
  sub: '用問的查案場、收付款、工進與待辦 —— 只能查，不能改',
  module: 'ai',
  help: {
    intro: 'AI 助理會替你到系統裡查資料再回答，看到的範圍跟你自己的帳號權限一樣：你看不到的（例如毛利），它也查不到。',
    steps: ['直接打問題，例如「本月還有哪些錢沒收？」「陳宅目前工進和追加單狀況？」，按「送出」或 Ctrl＋Enter。',
      '可以接著追問（「那逾期最久的是哪一筆？」），它會記得這個分頁裡前面的對話。',
      '回答下方會列出它查了哪些資料；數字要拿去對外使用前，請到對應頁面再確認一次。',
      '要改資料請到對應頁面操作 —— AI 助理只能查，不能新增、修改或刪除。'],
    notes: ['服務商（Claude 或 ChatGPT）、模型與 API 金鑰由管理員在「系統設定 → AI 助理」設定。',
      '問題與查到的資料會送到所選的 AI 服務商處理；系統的操作紀錄會留下誰問了什麼。',
      '換頁或重新整理後對話會清空。']
  },
  async render(el) {
    const st = await GET('/ai/status');
    const history = [];
    const examples = ['本月還有哪些錢沒收？', '哪些案子工期落後？', '有哪些追加單還沒簽認？', '我這週有哪些待辦？'];
    const providerName = { claude: 'Claude', openai: 'ChatGPT' }[st.provider] || '';

    el.innerHTML = `
      ${st.ready ? `<div class="muted" style="margin-bottom:8px">目前使用 ${UI.esc(providerName)}（${UI.esc(st.model)}），可查 ${st.tools.length} 類資料。</div>`
        : `<div class="notice warn">AI 助理還沒設定好。${App.can('settings')
          ? '請到 <a href="#settings">系統設定 → AI 助理</a> 選擇服務商並填入 API 金鑰。'
          : '請聯絡管理員到系統設定填入 AI 服務商與 API 金鑰。'}</div>`}
      <div class="card">
        <div id="ai-log" style="display:flex;flex-direction:column;gap:10px;min-height:120px;max-height:60vh;overflow-y:auto"></div>
        <div id="ai-examples" style="display:flex;flex-wrap:wrap;gap:6px;margin:10px 0">
          ${examples.map(q => `<button class="btn tiny secondary" data-ex="${UI.esc(q)}" type="button">${UI.esc(q)}</button>`).join('')}
        </div>
        <div class="form-row full"><textarea id="ai-input" rows="3" placeholder="想查什麼？例如：陳宅目前收了多少錢、還差多少？"${st.ready ? '' : ' disabled'}></textarea></div>
        <div class="actions">
          <button class="btn" id="ai-send" type="button"${st.ready ? '' : ' disabled'}>送出</button>
          <button class="btn secondary" id="ai-clear" type="button">清除對話</button>
        </div>
      </div>`;

    const log = el.querySelector('#ai-log');
    const input = el.querySelector('#ai-input');
    const sendBtn = el.querySelector('#ai-send');

    // 回覆只做最基本的排版：跳脫 HTML 後把 **粗體** 與換行轉出來，不執行任何模型產生的 HTML
    const format = text => UI.esc(text).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
    const bubble = (role, html, extra = '') => `<div style="align-self:${role === 'user' ? 'flex-end' : 'flex-start'};max-width:85%;
        padding:8px 12px;border-radius:10px;background:${role === 'user' ? 'var(--primary-soft, #e8f0fe)' : 'var(--card-soft, #f4f4f5)'}">
        ${html}${extra}</div>`;
    const draw = (pending) => {
      log.innerHTML = (history.length ? history.map(m => bubble(m.role, format(m.content),
        m.used && m.used.length ? `<div class="muted" style="margin-top:6px;font-size:12px">查了：${UI.esc([...new Set(m.used)].join('、'))}</div>` : ''))
        .join('') : '<div class="empty">還沒有對話。可以點下面的範例問題開始。</div>')
        + (pending ? bubble('assistant', '<span class="muted">查詢中…（可能需要數十秒）</span>') : '');
      log.scrollTop = log.scrollHeight;
    };

    const send = async text => {
      text = String(text || '').trim();
      if (!text || sendBtn.disabled) return;
      history.push({ role: 'user', content: text });
      input.value = '';
      sendBtn.disabled = true;
      draw(true);
      try {
        const r = await POST('/ai/chat', { messages: history.map(m => ({ role: m.role, content: m.content })) });
        history.push({ role: 'assistant', content: (r.reply || '（沒有回覆內容）') + (r.truncated ? '\n\n（回覆太長被截斷，請把問題縮小再問）' : ''), used: r.used });
      } catch (e) {
        history.pop();       // 失敗的問題不留在歷史裡，免得下一次送出時帶著沒有回答的問題
        input.value = text;
        UI.err(e);
      }
      sendBtn.disabled = !st.ready;
      draw(false);
      input.focus();
    };

    sendBtn.onclick = () => send(input.value);
    input.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send(input.value); });
    el.querySelectorAll('[data-ex]').forEach(b => b.onclick = () => { if (st.ready) send(b.dataset.ex); });
    el.querySelector('#ai-clear').onclick = () => { history.length = 0; draw(false); };
    draw(false);
  }
});
