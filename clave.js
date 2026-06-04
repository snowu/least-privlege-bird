// ── CLAVE SSO MOCK FLOW ────────────────────────────────────────────────────────
// Exposes: Clave.startLogin(playerName, onSuccess)
//          Clave.startScoreSubmit(playerName, score, onSuccess)

const Clave = (() => {

  // ── QUIZ QUESTIONS ──────────────────────────────────────────────────────────
  // type: 'single' = one correct answer, 'multi' = multiple correct answers
  // UI is identical — player doesn't know which type until they try
  const QUESTIONS = [
    {
      prompt: 'An explicit <strong>Deny</strong> in IAM always overrides an Allow.',
      type: 'single',
      options: [
        { text: 'True',                               correct: true,  explain: 'Correct. Explicit Deny always wins, regardless of any Allow.' },
        { text: 'False — Allow wins if more specific', correct: false, explain: 'Wrong. Specificity does not matter. Deny always overrides.' },
        { text: 'False — depends on policy type',      correct: false, explain: 'Wrong. Policy type (identity vs resource) does not change this rule.' },
        { text: 'Only for root account',               correct: false, explain: 'Wrong. Explicit Deny applies to all principals.' },
      ],
    },
    {
      prompt: 'Which of these are valid reasons to use an <strong>NLB</strong> over an ALB?',
      type: 'multi',
      options: [
        { text: 'You need a static IP address',            correct: true,  explain: 'NLBs support static/Elastic IPs. ALBs do not.' },
        { text: 'You need WebSocket support',              correct: false, explain: 'Both ALB and NLB support WebSockets.' },
        { text: 'You need ultra-low latency (TCP)',        correct: true,  explain: 'NLB operates at Layer 4 with lower latency than ALB.' },
        { text: 'You need host-based routing',             correct: false, explain: 'Host-based routing is an ALB feature only.' },
        { text: 'Your client requires TLS passthrough',   correct: true,  explain: 'NLB supports TLS passthrough. ALB terminates TLS.' },
      ],
    },
    {
      prompt: 'What is the maximum size of a single <strong>SQS</strong> message?',
      type: 'single',
      options: [
        { text: '64 KB',   correct: false, explain: 'Too small. That was an older limit.' },
        { text: '256 KB',  correct: true,  explain: 'Correct. 256 KB is the SQS message size limit.' },
        { text: '1 MB',    correct: false, explain: 'Wrong. Use S3 + SQS Extended Client for larger payloads.' },
        { text: 'Unlimited', correct: false, explain: 'Wrong. SQS has a hard 256 KB limit per message.' },
      ],
    },
    {
      prompt: 'A <strong>Security Group</strong> is stateful. What does that mean?',
      type: 'single',
      options: [
        { text: 'Return traffic is automatically allowed',         correct: true,  explain: 'Correct. Stateful means the return path is tracked and allowed automatically.' },
        { text: 'Rules persist across reboots',                   correct: false, explain: 'Wrong. "Stateful" refers to connection tracking, not persistence.' },
        { text: 'Rules are evaluated in order',                   correct: false, explain: 'Wrong. SG rules have no order. NACLs are evaluated in order.' },
        { text: 'You must explicitly allow both inbound and outbound', correct: false, explain: 'Wrong. That describes a NACL, which is stateless.' },
      ],
    },
    {
      prompt: 'Which of these <strong>S3 features</strong> help prevent accidental public data exposure?',
      type: 'multi',
      options: [
        { text: 'Block Public Access settings',      correct: true,  explain: 'Yes. Block Public Access is the primary guardrail for S3 public exposure.' },
        { text: 'Versioning',                        correct: false, explain: 'Versioning helps with accidental deletion, not public exposure.' },
        { text: 'Bucket policies with explicit Deny', correct: true, explain: 'Yes. An explicit Deny on s3:GetObject prevents public reads.' },
        { text: 'Server-side encryption',            correct: false, explain: 'Encryption protects data at rest, not access control.' },
        { text: 'Access Analyzer for S3',            correct: true,  explain: 'Yes. Access Analyzer alerts you when buckets are publicly accessible.' },
      ],
    },
    {
      prompt: 'What does <code>sts:AssumeRole</code> allow a principal to do?',
      type: 'single',
      options: [
        { text: 'Temporarily adopt another IAM role\'s permissions', correct: true,  explain: 'Correct. AssumeRole returns temporary credentials for the target role.' },
        { text: 'Create a new IAM role',                            correct: false, explain: 'Wrong. That would be iam:CreateRole.' },
        { text: 'List all roles in the account',                    correct: false, explain: 'Wrong. That would be iam:ListRoles.' },
        { text: 'Permanently switch your user\'s permissions',      correct: false, explain: 'Wrong. The credentials are temporary (STS = Security Token Service).' },
      ],
    },
    {
      prompt: 'Which of these AWS services are <strong>fully serverless</strong>?',
      type: 'multi',
      options: [
        { text: 'Lambda',        correct: true,  explain: 'Yes. No servers to manage, scales automatically.' },
        { text: 'ECS on EC2',    correct: false, explain: 'No. ECS on EC2 requires you to manage the underlying instances.' },
        { text: 'DynamoDB',      correct: true,  explain: 'Yes. DynamoDB is fully managed with no server provisioning.' },
        { text: 'RDS',           correct: false, explain: 'No. RDS runs on managed instances — you still pick the instance size.' },
        { text: 'Aurora Serverless v2', correct: true, explain: 'Yes. Aurora Serverless v2 scales automatically without provisioned instances.' },
        { text: 'ElastiCache',   correct: false, explain: 'No. ElastiCache requires you to provision node types and clusters.' },
      ],
    },
    {
      prompt: 'What happens when a <strong>bucket policy DENY</strong> and an <strong>IAM ALLOW</strong> both apply to the same S3 action?',
      type: 'single',
      options: [
        { text: 'Access is denied',                          correct: true,  explain: 'Correct. Explicit Deny always wins. The bucket policy Deny overrides the IAM Allow.' },
        { text: 'Access is allowed — IAM takes precedence', correct: false, explain: 'Wrong. Resource-based Deny is still an explicit Deny and wins.' },
        { text: 'The more specific policy wins',            correct: false, explain: 'Wrong. There is no "more specific" rule — Deny always wins.' },
        { text: 'It depends on evaluation order',           correct: false, explain: 'Wrong. AWS policy evaluation always applies Deny first, regardless of order.' },
      ],
    },
    {
      prompt: 'Which of these IAM policies best follow <strong>least privilege</strong> for a Lambda that only reads from one S3 bucket?',
      type: 'single',
      options: [
        { text: 'Action: s3:* — Resource: *',                              correct: false, explain: 'Wrong. s3:* on * is the opposite of least privilege.' },
        { text: 'Action: s3:GetObject — Resource: arn:aws:s3:::my-bucket/*', correct: true, explain: 'Correct. Scoped to the exact action and resource needed.' },
        { text: 'Action: s3:GetObject — Resource: *',                      correct: false, explain: 'Better, but still grants read access to all S3 buckets.' },
        { text: 'Action: * — Resource: arn:aws:s3:::my-bucket/*',          correct: false, explain: 'Wrong. Wildcard action grants all operations including delete.' },
      ],
    },
    {
      prompt: 'Which architectures eliminate a <strong>Single Point of Failure</strong>?',
      type: 'multi',
      options: [
        { text: 'Multi-AZ RDS with automatic failover',  correct: true,  explain: 'Yes. Automatic failover to standby removes the SPOF.' },
        { text: 'Single EC2 instance with EBS',          correct: false, explain: 'No. One instance = one SPOF. If it dies, the service dies.' },
        { text: 'ALB with ASG across 3 AZs',             correct: true,  explain: 'Yes. Traffic is distributed, any single instance failure is absorbed.' },
        { text: 'NAT Gateway in one AZ only',            correct: false, explain: 'No. If that AZ has issues, all outbound traffic from other AZs fails.' },
        { text: 'Route 53 with health checks + failover',correct: true,  explain: 'Yes. DNS-level failover routes traffic away from unhealthy endpoints.' },
      ],
    },
  ];

  // Pick two distinct random questions per session
  const _picks = (() => {
    const idx = Array.from({length: QUESTIONS.length}, (_, i) => i);
    idx.sort(() => Math.random() - 0.5);
    return [idx[0], idx[1]];
  })();

  // ── CAPTCHA (QUIZ) BUILDER ──────────────────────────────────────────────────
  function buildCaptcha(containerId, questionIdx, onSuccess) {
    const q = QUESTIONS[questionIdx];
    const container = document.getElementById(containerId);
    let failCount = 0;

    function render() {
      container.innerHTML = '';
      const panel = document.createElement('div');
      panel.className = 'captcha-panel';
      panel.innerHTML = `
        <h2>🤖 Identity Verification — AWS Knowledge Check</h2>
        <p class="sub" style="font-size:0.9rem;color:#c8d6f8;">${q.prompt}</p>
        <div class="captcha-grid" id="${containerId}-grid"></div>
        <div id="${containerId}-feedback" style="width:100%;display:none;flex-direction:column;gap:6px;"></div>
        <p class="captcha-error" id="${containerId}-err"></p>
        <button id="${containerId}-btn">Verify</button>
      `;
      container.appendChild(panel);
      show(containerId);

      const grid = document.getElementById(`${containerId}-grid`);
      q.options.forEach((opt, i) => {
        const tile = document.createElement('div');
        tile.className = 'captcha-tile';
        tile.dataset.idx = i;
        tile.innerHTML = `<span class="tile-label" style="font-size:0.88rem;">${opt.text}</span>`;
        tile.addEventListener('click', () => {
          if (q.type === 'single') {
            // deselect others
            grid.querySelectorAll('.captcha-tile').forEach(t => t.classList.remove('selected'));
          }
          tile.classList.toggle('selected');
        });
        grid.appendChild(tile);
      });

      document.getElementById(`${containerId}-btn`).addEventListener('click', async () => {
        const selected = [...grid.querySelectorAll('.captcha-tile.selected')].map(t => +t.dataset.idx);
        const correct  = q.options.map((o,i) => o.correct ? i : -1).filter(i => i >= 0);
        const isCorrect = selected.length === correct.length &&
                          selected.every(i => correct.includes(i));

        if (isCorrect) { onSuccess(); return; }

        failCount++;
        const lockMs = Math.pow(2, failCount - 1) * 1000;

        // Show per-option explanations
        const fb = document.getElementById(`${containerId}-feedback`);
        fb.style.display = 'flex';
        fb.innerHTML = q.options.map((o, i) => {
          const wasSelected = selected.includes(i);
          const icon = o.correct ? '✅' : (wasSelected ? '❌' : '◻️');
          return `<div style="font-size:0.78rem;color:#a0b0cc;line-height:1.4;">
            <span>${icon}</span> <strong style="color:${o.correct ? '#51cf66' : '#ff6b6b'}">${o.text}</strong>
            — ${o.explain}
          </div>`;
        }).join('');

        // Show help button after 2 failures
        if (failCount >= 2 && !document.getElementById(`${containerId}-help-btn`)) {
          const helpBtn = document.createElement('button');
          helpBtn.id = `${containerId}-help-btn`;
          helpBtn.textContent = '🆘 Need help? (Solve to unlock hints)';
          helpBtn.style.cssText = 'margin-top:8px;font-size:0.8rem;background:#2a3a5c;border:1px solid #4a6a9a;color:#c8d6f8;padding:6px 12px;cursor:pointer;border-radius:4px;';
          fb.after(helpBtn);
          helpBtn.addEventListener('click', () => {
            const a = Math.floor(Math.random() * 12) + 2;
            const b = Math.floor(Math.random() * 12) + 2;
            const answer = a * b;
            helpBtn.style.display = 'none';
            const mathDiv = document.createElement('div');
            mathDiv.style.cssText = 'margin-top:8px;display:flex;align-items:center;gap:8px;';
            mathDiv.innerHTML = `
              <span style="color:#c8d6f8;font-size:0.85rem;">Solve: ${a} × ${b} =</span>
              <input id="${containerId}-math-input" type="number" style="width:60px;padding:4px;background:#1a2a4c;border:1px solid #4a6a9a;color:#fff;border-radius:3px;">
              <button id="${containerId}-math-btn" style="font-size:0.8rem;padding:4px 10px;background:#3a5a8c;border:none;color:#fff;border-radius:3px;cursor:pointer;">Submit</button>
              <span id="${containerId}-math-err" style="color:#ff6b6b;font-size:0.75rem;"></span>
            `;
            helpBtn.after(mathDiv);
            document.getElementById(`${containerId}-math-btn`).addEventListener('click', () => {
              const val = +document.getElementById(`${containerId}-math-input`).value;
              if (val === answer) {
                mathDiv.remove();
                fb.style.display = 'flex';
                fb.dataset.locked = 'true';
              } else {
                document.getElementById(`${containerId}-math-err`).textContent = '❌ Incorrect';
              }
            });
          });
        }

        // Lockout countdown
        const errEl = document.getElementById(`${containerId}-err`);
        const btn   = document.getElementById(`${containerId}-btn`);
        btn.disabled = true;
        grid.querySelectorAll('.captcha-tile').forEach(t => t.classList.remove('selected'));
        grid.style.pointerEvents = 'none';

        let remaining = lockMs / 1000;
        errEl.textContent = `⛔ Incorrect. Account suspended. Retry in ${remaining}s`;
        const tick = setInterval(() => {
          remaining--;
          if (remaining <= 0) {
            clearInterval(tick);
            errEl.textContent = '';
            btn.disabled = false;
            grid.style.pointerEvents = '';
            if (fb.dataset.locked !== 'true') fb.style.display = 'none';
          } else {
            errEl.textContent = `⛔ Incorrect. Account suspended. Retry in ${remaining}s`;
          }
        }, 1000);
      });
    }

    render();
  }

  // ── HELPERS ─────────────────────────────────────────────────────────────────
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

  const delay = ms => new Promise(r => setTimeout(r, ms));

  function show(id)  { document.getElementById(id).classList.remove('hidden'); }
  function hide(id)  { document.getElementById(id).classList.add('hidden'); }
  function hideAll() {
    ['clave-step-captcha-pre','clave-step-connecting','clave-step-verifying',
     'clave-step-mfa','clave-step-entitlements','clave-step-granted','clave-step-expired']
      .forEach(hide);
  }

  function showClaveStep(id) { hideAll(); show(id); }

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
    btn.disabled = false;
    btn.textContent = 'Verify Identity';
    btn.style.left = '0px'; btn.style.top = '0px'; btn.style.transition = '';

    // Dodge logic: button runs away 4 times then stops
    let dodges = 0;    const MAX_DODGES = 4;
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
    if (!window.DEV_MODE) {
      showClaveStep('clave-step-captcha-pre');
      await new Promise(resolve => buildCaptcha('clave-step-captcha-pre', _picks[0], resolve));
    }

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
    if (!window.DEV_MODE) {
      show('captcha-post-screen');
      await new Promise(resolve => buildCaptcha('captcha-post-screen', _picks[1], resolve));
      hide('captcha-post-screen');
    }

    // Score submit log
    show('score-submit-screen');
    document.getElementById('submit-user-path').textContent = playerName.toLowerCase();
    await animateLog('submit-log', SUBMIT_LINES.map(l => l.replace('{user}', playerName.toLowerCase())), playerName);
    hide('score-submit-screen');

    onSuccess();
  }

  return { startLogin, startScoreSubmit };
})();
