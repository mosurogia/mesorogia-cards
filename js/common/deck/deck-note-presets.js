/**
 * js/common/deck/deck-note-presets.js
 * - デッキ解説プリセットの共通定義とUI操作
 */
(function () {
  'use strict';

  const templates = {
    'deck-overview':
`【デッキ概要】


【キーカード】


【試合の立ち回り】

`,

    'play-guide':
`【マリガン基準】


【リーサルプラン】



【プレイのコツ】


`,

    'matchup':
`【相性一覧】
〈有利対面〉

〈不利対面〉

【採用候補、対策カード】

`,

    'results':
`【使用環境】


【戦績】


【評価】
`,
  };

  const sections = {
    'deck-summary': {
      label: 'デッキ概要',
      text: `【デッキ概要】

  `,
      help: 'デッキのコンセプト、狙う勝ち筋、全体の動きを最初に伝える項目です。'
    },
    'key-cards': {
      label: 'キーカード',
      text: `【キーカード】

  `,
      help: '主軸カード、コンボ、採用理由などをまとめる項目です。'
    },
    'play-flow': {
      label: '試合の立ち回り',
      text: `【試合の立ち回り】
  〈序盤〉


  〈中盤〉


  〈終盤〉

  `,
      help: '序盤・中盤・終盤で意識する動きや優先順位を整理する項目です。'
    },
    'mulligan': {
      label: 'マリガン基準',
      text: `【マリガン基準】

  `,
      help: '初手で残すカード、返すカード、相手ごとの判断を書きます。'
    },
    'lethal-plan': {
      label: 'リーサルプラン',
      text: `【リーサルプラン】

  `,
      help: '勝ち切るための打点、詰め方、代表的な勝ち筋を書く項目です。'
    },
    'play-tips': {
      label: 'プレイのコツ',
      text: `【プレイのコツ】

  `,
      help: '使うタイミング、注意点、ミスしやすい場面などを書く項目です。'
    },
    'warnings': {
      label: '注意点',
      text: `【注意点】

  `,
      help: '使う上で気をつけるポイントや弱点を書きます。'
    },
    'matchups': {
      label: '相性一覧',
      text: `【相性一覧】
  〈有利対面〉


  〈不利対面〉


  `,
      help: '有利・不利な相手や、その理由を簡単にまとめます。'
    },
    'bad-matchups': {
      label: '苦手対面',
      text: `【苦手対面】

  `,
      help: '特に苦しい相手や、その理由、意識する対策を書きます。'
    },
    'tech-cards': {
      label: '採用候補、対策カード',
      text: `【採用候補、対策カード】

  `,
      help: '入れ替え候補、メタカード、不採用理由を補足する項目です。'
    },
    'adoption-reason': {
      label: '採用理由',
      text: `【採用理由】

  `,
      help: '採用したカードや構築の意図を補足する項目です。'
    },
    'not-picked': {
      label: '不採用候補',
      text: `【不採用候補】

  `,
      help: '候補だったが今回は入れなかったカードや、その理由を書きます。'
    },
    'environment': {
      label: '使用環境',
      text: `【使用環境】

  `,
      help: 'どの時期・レート帯・環境で使ったデッキかを示します。'
    },
    'record': {
      label: '戦績',
      text: `【戦績】

  `,
      help: '総試合数、勝敗、体感勝率などを記録する項目です。'
    },
    'rating': {
      label: '評価',
      text: `【評価】

  `,
      help: '使ってみた強さや印象、どんな人に向いているかを書きます。'
    },
    'target-user': {
      label: '向いている人',
      text: `【向いている人】

  `,
      help: 'どんなプレイスタイルや資産状況の人に向くかを書きます。'
    }
  };

  const primarySectionKeys = [
    'deck-summary',
    'key-cards',
    'play-flow',
    'mulligan',
    'lethal-plan',
    'matchups'
  ];

  const extraSectionKeys = [
    'play-tips',
    'tech-cards',
    'environment',
    'record',
    'rating',
    'warnings',
    'bad-matchups',
    'adoption-reason',
    'not-picked',
    'target-user'
  ];

  const templateLabels = {
    'deck-overview': '初心者向け基本セット',
    'play-guide': 'プレイ解説セット',
    'matchup': '対面・環境セット',
    'results': '実績・評価セット'
  };

  const templateHelps = {
    'deck-overview': 'デッキの基本構成を追加します\n\n・概要：コンセプトと勝ち筋\n・キーカード：主軸カードやコンボ\n・立ち回り：試合の流れ（序盤、中盤、終盤）',
    'play-guide': 'プレイ面の解説を追加します\n\n・マリガン：初期手札で何をキープするか\n・リーサル：勝ち切る打点やプラン\n・プレイのコツ：判断や注意点',
    'matchup': '対面や環境考察を追加します\n\n・相性：現環境で有利・不利な相手\n・対策：採用候補やメタカード',
    'results': 'デッキの使用結果と評価をまとめます\n\n・環境：使用した環境やレート帯\n・戦績：勝率や試合数\n・評価：使ってみた強さや印象'
  };

  function insertText(el, text, range) {
    if (!el || !text) return;
    const v = el.value || '';
    const start = Number.isFinite(range?.start) ? range.start : (el.selectionStart ?? v.length);
    const end = Number.isFinite(range?.end) ? range.end : (el.selectionEnd ?? v.length);
    el.value = v.slice(0, start) + text + v.slice(end);
    el.focus();
    try { el.selectionStart = el.selectionEnd = start + text.length; } catch (_) {}
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function appendText(el, text) {
    if (!el || !text) return;
    const cur = el.value || '';
    el.value = cur.trim() ? cur + (cur.endsWith('\n') ? '\n' : '\n\n') + text : text;
    el.focus();
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function getText(type, key) {
    return type === 'section' ? sections[key]?.text : templates[key];
  }

  function buildSectionItems(showAll) {
    const keys = showAll ? primarySectionKeys.concat(extraSectionKeys) : primarySectionKeys;
    return keys.map((key) => {
      const item = sections[key];
      if (!item) return null;
      return { key, label: item.label, text: item.text, help: item.help, type: 'section' };
    }).filter(Boolean);
  }

  function buildTemplateItems() {
    return Object.keys(templates).map((key) => ({
      key,
      label: templateLabels[key] || key,
      text: templates[key],
      help: templateHelps[key] || '',
      type: 'template'
    }));
  }

  function getPanel(btn) {
    const scope = btn.closest?.('.decknote-editor, .text-side, .info-value') || document;
    return scope.querySelector?.('.note-preset-panel');
  }

  function setHelp(panel, text) {
    const help = panel?.querySelector?.('.note-preset-help');
    if (help) help.textContent = text || '項目の説明を表示します。';
  }

  function closePanels(exceptPanel) {
    document.querySelectorAll('.note-preset-panel').forEach((panel) => {
      if (panel === exceptPanel) return;
      panel.hidden = true;
      panel.innerHTML = '';
      panel.removeAttribute('data-menu');
    });

    document.querySelectorAll('.note-preset-menu-btn').forEach((btn) => {
      const panel = getPanel(btn);
      if (panel !== exceptPanel) btn.setAttribute('aria-pressed', 'false');
    });
  }

  function renderPanel(panel, menu, showAllSections = false) {
    if (!panel) return;

    const isSections = menu === 'sections';
    const items = isSections ? buildSectionItems(showAllSections) : buildTemplateItems();

    panel.hidden = false;
    panel.dataset.menu = menu;
    panel.dataset.showAllSections = showAllSections ? 'true' : 'false';
    panel.innerHTML = '';

    const list = document.createElement('div');
    list.className = 'note-preset-list';

    for (const item of items) {
      const row = document.createElement('div');
      row.className = 'note-preset-choice-row';

      const insertBtn = document.createElement('button');
      insertBtn.type = 'button';
      insertBtn.className = 'note-preset-choice';
      insertBtn.dataset.presetType = item.type;
      insertBtn.dataset.presetKey = item.key;
      insertBtn.textContent = item.label;

      const helpBtn = document.createElement('button');
      helpBtn.type = 'button';
      helpBtn.className = 'note-preset-help-btn';
      helpBtn.dataset.help = item.help;
      helpBtn.setAttribute('aria-label', `${item.label}の説明`);
      helpBtn.textContent = '?';

      row.appendChild(insertBtn);
      row.appendChild(helpBtn);
      list.appendChild(row);
    }

    if (isSections) {
      const moreRow = document.createElement('div');
      moreRow.className = 'note-preset-more-row';

      const moreBtn = document.createElement('button');
      moreBtn.type = 'button';
      moreBtn.className = 'note-preset-more-btn';
      moreBtn.textContent = showAllSections ? 'その他の項目を閉じる' : 'その他の項目を表示';

      moreRow.appendChild(moreBtn);
      list.appendChild(moreRow);
    }

    const help = document.createElement('div');
    help.className = 'note-preset-help';
    help.setAttribute('role', 'status');
    help.textContent = isSections
      ? 'よく使う項目だけを表示しています。必要な場合はその他の項目を開けます。'
      : '記事の構成セットを挿入できます。';

    panel.appendChild(list);
    panel.appendChild(help);
  }

  function bindPresetUi(options = {}) {
    const key = options.key || 'default';
    const flag = `__deckNotePresetBound_${key}`;
    if (window[flag]) return;
    window[flag] = true;

    const getTarget = typeof options.getTarget === 'function'
      ? options.getTarget
      : () => document.getElementById('post-note');

    document.addEventListener('click', (e) => {
      if (!e.target.closest?.('.note-preset-wrap')) {
        closePanels();
      }

      const menuBtn = e.target.closest?.('.note-preset-menu-btn');
      if (menuBtn) {
        const panel = getPanel(menuBtn);
        const menu = menuBtn.dataset.presetMenu;
        const isOpen = panel && !panel.hidden && panel.dataset.menu === menu;

        closePanels(panel);

        if (isOpen) {
          panel.hidden = true;
          panel.innerHTML = '';
          panel.removeAttribute('data-menu');
          menuBtn.setAttribute('aria-pressed', 'false');
        } else {
          renderPanel(panel, menu);
          menuBtn.setAttribute('aria-pressed', 'true');
        }
        return;
      }

      const cardRefBtn = e.target.closest?.('.note-card-ref-btn');
      if (cardRefBtn) {
        closePanels();
        options.openCardRefPicker?.(cardRefBtn);
        return;
      }

      const helpBtn = e.target.closest?.('.note-preset-help-btn');
      if (helpBtn) {
        setHelp(helpBtn.closest('.note-preset-panel'), helpBtn.dataset.help);
        return;
      }

      const moreBtn = e.target.closest?.('.note-preset-more-btn');
      if (moreBtn) {
        const panel = moreBtn.closest('.note-preset-panel');
        const showAll = panel?.dataset.showAllSections !== 'true';
        renderPanel(panel, 'sections', showAll);
        return;
      }

      const choiceBtn = e.target.closest?.('.note-preset-choice');
      if (choiceBtn) {
        const text = getText(choiceBtn.dataset.presetType, choiceBtn.dataset.presetKey);
        if (!text) return;
        insertText(getTarget(choiceBtn), text);
        closePanels();
        return;
      }

      return;
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closePanels();
    });
  }

  window.DeckNotePresets = {
    templates,
    sections,
    primarySectionKeys,
    extraSectionKeys,
    templateLabels,
    templateHelps,
    insertText,
    appendText,
    getText,
    buildSectionItems,
    buildTemplateItems,
    renderPanel,
    closePanels,
    bindPresetUi
  };

  window.NOTE_PRESETS = window.NOTE_PRESETS || templates;
})();
