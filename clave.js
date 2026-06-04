// ── CLAVE SSO MOCK FLOW ────────────────────────────────────────────────────────
// Exposes: Clave.startLogin(playerName, onSuccess)
//          Clave.startScoreSubmit(playerName, score, onSuccess)

const Clave = (() => {

  // ── CAPTCHA DATA ────────────────────────────────────────────────────────────
  const CAPTCHA_CHALLENGES = [
    {
      prompt: 'Select all images containing a <strong>load balancer</strong>',
      sub: 'If there are none, click <em>Skip</em>',
      tiles: [
        { emoji: '⚖️',  label: 'ALB',              correct: true  },
        { emoji: '🪣',  label: 'S3 Bucket',         correct: false },
        { emoji: '⚖️',  label: 'NLB',              correct: true  },
        { emoji: '🔑',  label: 'KMS Key',           correct: false },
        { emoji: '🖥️',  label: 'EC2 Instance',      correct: false },
        { emoji: '⚖️',  label: 'GLB',              correct: true  },
        { emoji: '🌐',  label: 'Route 53',          correct: false },
        { emoji: '📦',  label: 'Lambda Fn',         correct: false },
        { emoji: '🔒',  label: 'Security Group',    correct: false },
        { emoji: '⚖️',  label: 'CLB (legacy)',      correct: true  },
        { emoji: '🗄️',  label: 'RDS Instance',      correct: false },
        { emoji: '📋',  label: 'IAM Policy',        correct: false },
      ],
    },
    {
      prompt: 'Select all <strong>deprecated</strong> AWS services',
      sub: 'These services have been sunset or are in maintenance-only mode',
      tiles: [
        { emoji: '🪦',  label: 'SimpleDB',          correct: true  },
        { emoji: '🟢',  label: 'DynamoDB',          correct: false },
        { emoji: '🪦',  label: 'EC2-Classic',       correct: true  },
        { emoji: '🟢',  label: 'Lambda',            correct: false },
        { emoji: '🪦',  label: 'CodeCommit',        correct: true  },
        { emoji: '🟢',  label: 'S3',               correct: false },
        { emoji: '🪦',  label: 'SWF',              correct: true  },
        { emoji: '🟢',  label: 'SQS',              correct: false },
        { emoji: '🪦',  label: 'Elastic Beanstalk', correct: true  },
        { emoji: '🟢',  label: 'CloudFront',        correct: false },
        { emoji: '🪦',  label: 'OpsWorks',          correct: true  },
        { emoji: '🟢',  label: 'ECS',              correct: false },
      ],
    },
    {
      prompt: 'Select all images showing a <strong>Single Point of Failure</strong>',
      sub: 'Choose every architecture that would take down the whole system',
      tiles: [
        { emoji: '💀',  label: 'Single AZ RDS',     correct: true  },
        { emoji: '✅',  label: 'Multi-AZ RDS',      correct: false },
        { emoji: '💀',  label: 'One EC2, no ASG',   correct: true  },
        { emoji: '✅',  label: 'ASG min:2',         correct: false },
        { emoji: '💀',  label: 'Single NAT GW',     correct: true  },
        { emoji: '✅',  label: 'NAT GW per AZ',     correct: false },
        { emoji: '💀',  label: 'No read replicas',  correct: true  },
        { emoji: '✅',  label: 'Aurora Global',     correct: false },
        { emoji: '💀',  label: 'One Availability Zone', correct: true  },
        { emoji: '✅',  label: '3-AZ deployment',   correct: false },
        { emoji: '💀',  label: 'Hardcoded AZ: us-east-1a', correct: true },
        { emoji: '✅',  label: 'Route 53 failover', correct: false },
      ],
    },
    {
      prompt: 'Select all <strong>correctly tagged</strong> AWS resources',
      sub: 'Required tags: Environment, Owner, CostCenter',
      tiles: [
        { emoji: '✅',  label: 'i-0abc Env:prod Owner:tom CC:eng', correct: true  },
        { emoji: '🚫',  label: 'i-0def (no tags)',                 correct: false },
        { emoji: '✅',  label: 'rds-01 Env:prod Owner:ana CC:data',correct: true  },
        { emoji: '🚫',  label: 'bucket-xyz Owner:unknown',         correct: false },
        { emoji: '✅',  label: 'fn-api Env:dev Owner:dev CC:eng',  correct: true  },
        { emoji: '🚫',  label: 'sg-9999 Env:prod (missing Owner)', correct: false },
        { emoji: '✅',  label: 'alb-web Env:stg Owner:ops CC:inf', correct: true  },
        { emoji: '🚫',  label: 'vpc-0f1 (no tags at all)',         correct: false },
        { emoji: '✅',  label: 'eks-cl Env:prod Owner:plat CC:inf',correct: true  },
        { emoji: '🚫',  label: 'snap-44 CostCenter:??? Owner:???', correct: false },
        { emoji: '✅',  label: 'cf-dist Env:prod Owner:fe CC:web', correct: true  },
        { emoji: '🚫',  label: 'igw-03 (inherited, not explicit)', correct: false },
      ],
    },
  ];

  // Pick two distinct random challenges (used for pre-login and post-game)
  const _picks = (() => {
    const idx = Array.from({length: CAPTCHA_CHALLENGES.length}, (_, i) => i);
    idx.sort(() => Math.random() - 0.5);
    return [idx[0], idx[1]];
  })();

  const VERIFY_STEPS = [
    'Querying Active Directory... done',
    'Validating Midway token... done',
    'Checking Isengard federation... done',
    'Resolving group memberships (847 groups)...',
    'Applying ABAC policies...',
    'Cross-referencing Phonetool... done',
    'Evaluating SCPs... done',
    'Verifying MFA posture...',
  ];

  const ENTITLEMENT_LINES = [
    'GET iam:ListPolicies → 200 OK (312ms)',
    'Evaluating policy: AmazonFlappyKiroReadOnly... DENY',
    'Evaluating policy: AmazonFlappyKiroPlayer... ALLOW',
    'Evaluating policy: AmazonFlappyKiroHighScoreWrite... ALLOW',
    'Evaluating policy: AmazonFlappyKiroAuditLog... ALLOW',
    'SCP: ou-prod-games → no explicit deny',
    'Permission boundary: FlappyKiroPlayer-Prod → within bounds',
    'Session policy: inline → 3 statements evaluated',
    'Effective permissions: game:flap:write ✓',
    'Effective permissions: score:submit:put ✓',
    'Generating STS session token... done',
    'Token ARN: arn:aws:sts::139478927430:assumed-role/FlappyKiroPlayer-Prod/session',
  ];

  const SUBMIT_LINES = [
    'Assuming role FlappyKiroPlayer-Prod... done',
    'PUT s3://flappy-kiro-audit-logs-prod/scores/{user}.json',
    'Requesting KMS data key (mrk-flappy)... 200 OK',
    'Encrypting payload with AES-256-GCM...',
    'Uploading 847 bytes to S3... done',
    'Writing to DynamoDB audit table... done',
    'Publishing SNS notification to compliance team...',
    'Score verified and immutably recorded. ✓',
  ];

  // ── HELPERS ─────────────────────────────────────────────────────────────────
  const delay = ms => new Promise(r => setTimeout(r, ms));

  function show(id)  { document.getElementById(id).classList.remove('hidden'); }
  function hide(id)  { document.getElementById(id).classList.add('hidden'); }
  function hideAll() {
    ['clave-step-captcha-pre','clave-step-connecting','clave-step-verifying',
     'clave-step-mfa','clave-step-entitlements','clave-step-granted','clave-step-expired']
      .forEach(hide);
  }

  function showClaveStep(id) { hideAll(); show(id); }

  // ── CAPTCHA BUILDER ─────────────────────────────────────────────────────────
  function buildCaptcha(containerId, challengeIdx, onSuccess) {
    const ch = CAPTCHA_CHALLENGES[challengeIdx];
    const container = document.getElementById(containerId);
    let attempts = 0;

    function render() {
      container.innerHTML = '';
      const panel = document.createElement('div');
      panel.className = 'captcha-panel';

      panel.innerHTML = `
        <h2>🤖 Security Verification</h2>
        <p class="sub">${ch.prompt}</p>
        <p class="sub">${ch.sub}</p>
        <div class="captcha-grid" id="${containerId}-grid"></div>
        <p class="captcha-error" id="${containerId}-err"></p>
        <button id="${containerId}-btn">Verify</button>
      `;
      container.appendChild(panel);
      show(containerId);

      const grid = document.getElementById(`${containerId}-grid`);
      ch.tiles.forEach((t, i) => {
        const tile = document.createElement('div');
        tile.className = 'captcha-tile';
        tile.dataset.idx = i;
        tile.innerHTML = `<span class="tile-emoji">${t.emoji}</span><span class="tile-label">${t.label}</span>`;
        tile.addEventListener('click', () => tile.classList.toggle('selected'));
        grid.appendChild(tile);
      });

      document.getElementById(`${containerId}-btn`).addEventListener('click', () => {
        const selected = [...grid.querySelectorAll('.captcha-tile.selected')].map(t => +t.dataset.idx);
        const correct  = ch.tiles.map((t,i) => t.correct ? i : -1).filter(i => i >= 0);
        const isCorrect = selected.length === correct.length &&
                          selected.every(i => correct.includes(i));
        attempts++;
        if (isCorrect) {
          onSuccess();
        } else {
          document.getElementById(`${containerId}-err`).textContent =
            attempts === 1
              ? '❌ Incorrect selection. Please try again.'
              : `❌ ${attempts} failed attempts recorded. Your compliance score has been updated.`;
          grid.querySelectorAll('.captcha-tile').forEach(t => t.classList.remove('selected'));
        }
      });
    }

    render();
  }

  // ── VERIFY BAR ANIMATION ────────────────────────────────────────────────────
  async function animateVerifyBar() {
    const bar    = document.getElementById('verify-bar');
    const status = document.getElementById('verify-status');
    for (let i = 0; i < VERIFY_STEPS.length; i++) {
      status.textContent = VERIFY_STEPS[i];
      bar.style.width = `${Math.round((i + 1) / VERIFY_STEPS.length * 100)}%`;
      await delay(250 + Math.random() * 200);
    }
    await delay(300);
  }

  // ── ENTITLEMENTS LOG ANIMATION ──────────────────────────────────────────────
  async function animateLog(logId, lines, playerName) {
    const el = document.getElementById(logId);
    el.textContent = '';
    for (const line of lines) {
      el.textContent += line.replace('{user}', playerName) + '\n';
      el.scrollTop = el.scrollHeight;
      await delay(150 + Math.random() * 180);
    }
    await delay(400);
  }

  // ── MFA STEP ────────────────────────────────────────────────────────────────
  function showMFA() {
    showClaveStep('clave-step-mfa');
    let mfaAttempts = 0;
    const input  = document.getElementById('mfa-input');
    const errEl  = document.getElementById('mfa-error');
    const hint   = document.getElementById('mfa-attempt-hint');
    const btn    = document.getElementById('btn-mfa-verify');
    const wrap   = document.getElementById('btn-mfa-verify-wrap');
    input.value  = '';
    errEl.textContent = '';
    hint.classList.add('hidden');

    // Reset button position
    btn.style.left = '0px'; btn.style.top = '0px';

    // Dodge logic: button runs away 4 times then stops
    let dodges = 0;
    const MAX_DODGES = 4;
    function dodge() {
      if (dodges >= MAX_DODGES) return;
      dodges++;
      const wRect = wrap.getBoundingClientRect();
      const bRect = btn.getBoundingClientRect();
      // Pick a random spot inside the overlay (canvas area) away from cursor
      const ox = Math.random() < 0.5 ? -120 - Math.random() * 80 : 120 + Math.random() * 80;
      const oy = Math.random() < 0.5 ? -60  - Math.random() * 40 : 60  + Math.random() * 40;
      const newLeft = parseFloat(btn.style.left || 0) + ox;
      const newTop  = parseFloat(btn.style.top  || 0) + oy;
      btn.style.transition = 'left 0.18s ease, top 0.18s ease';
      btn.style.left = newLeft + 'px';
      btn.style.top  = newTop  + 'px';
      if (dodges === MAX_DODGES) {
        // Snap back after a beat
        setTimeout(() => {
          btn.style.transition = 'left 0.3s ease, top 0.3s ease';
          btn.style.left = '0px'; btn.style.top = '0px';
          btn.removeEventListener('mouseenter', dodge);
        }, 600);
      }
    }
    btn.addEventListener('mouseenter', dodge);

    return new Promise(resolve => {
      btn.onclick = async () => {
        if (!input.value.trim()) {
          input.classList.add('shake');
          errEl.textContent = '❌ Token required. Please enter the digits.';
          setTimeout(() => input.classList.remove('shake'), 500);
          return;
        }
        mfaAttempts++;
        if (mfaAttempts === 1) {
          // First attempt: always fail
          input.classList.add('shake');
          errEl.textContent = '❌ Token mismatch. Security policy requires re-verification.';
          hint.textContent  = 'ℹ️ This is expected. Clave performs zero-trust double-verification. Please re-enter.';
          hint.classList.remove('hidden');
          setTimeout(() => input.classList.remove('shake'), 500);
          input.value = '';
        } else {
          // Second attempt: always succeed
          errEl.textContent = '';
          btn.disabled = true;
          btn.textContent = 'Authenticating device...';
          await delay(1200);
          resolve();
        }
      };
    });
  }

  // ── MAIN LOGIN FLOW ─────────────────────────────────────────────────────────
  async function startLogin(playerName, onSuccess) {
    show('clave-screen');

    // Step 1 — CAPTCHA pre-login
    showClaveStep('clave-step-captcha-pre');
    await new Promise(resolve => buildCaptcha('clave-step-captcha-pre', _picks[0], resolve));

    // Step 2 — Connecting spinner
    showClaveStep('clave-step-connecting');
    await delay(1800);

    // Step 3 — Verify progress bar
    showClaveStep('clave-step-verifying');
    await animateVerifyBar();

    // Step 4 — MFA
    await showMFA();

    // Step 5 — Entitlements (with 10% session timeout chance)
    showClaveStep('clave-step-entitlements');
    if (Math.random() < 0.10) {
      await delay(900);
      showClaveStep('clave-step-expired');
      await new Promise(resolve => {
        document.getElementById('btn-reauth').onclick = () => {
          hide('clave-screen');
          startLogin(playerName, onSuccess); // restart the whole flow
          resolve('restarted');
        };
      });
      return; // prevent double-calling onSuccess
    }
    await animateLog('entitlements-log', ENTITLEMENT_LINES, playerName);

    // Step 6 — Granted
    showClaveStep('clave-step-granted');
    document.getElementById('granted-user').textContent = playerName;
    await delay(1800);

    hide('clave-screen');
    onSuccess();
  }

  // ── POST-GAME SCORE SUBMIT FLOW ─────────────────────────────────────────────
  async function startScoreSubmit(playerName, score, onSuccess) {
    // CAPTCHA #2
    show('captcha-post-screen');
    await new Promise(resolve => buildCaptcha('captcha-post-screen', _picks[1], resolve));
    hide('captcha-post-screen');

    // Score submit log
    show('score-submit-screen');
    document.getElementById('submit-user-path').textContent = playerName.toLowerCase();
    await animateLog('submit-log', SUBMIT_LINES.map(l => l.replace('{user}', playerName.toLowerCase())), playerName);
    hide('score-submit-screen');

    onSuccess();
  }

  return { startLogin, startScoreSubmit };
})();
