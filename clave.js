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

    // ── GENERAL TECH: PYTHON ────────────────────────────────────────────────
    {
      prompt: 'In Python, what does a <strong>mutable default argument</strong> like <code>def f(x, acc=[])</code> cause?',
      type: 'single',
      options: [
        { text: 'The list is shared across all calls', correct: true,  explain: 'Correct. Default args are evaluated once at definition. The same list persists between calls — a classic footgun. Use acc=None then acc = acc or [].' },
        { text: 'A fresh list every call',             correct: false, explain: 'Wrong. That is the intuition that bites people — the default is created once, not per call.' },
        { text: 'A SyntaxError',                        correct: false, explain: 'Wrong. It is perfectly valid syntax, just dangerous.' },
        { text: 'The list is garbage collected immediately', correct: false, explain: 'Wrong. It lives as long as the function object does.' },
      ],
    },
    {
      prompt: 'Which statements about the Python <strong>GIL</strong> (Global Interpreter Lock) are true?',
      type: 'multi',
      options: [
        { text: 'Only one thread executes Python bytecode at a time', correct: true,  explain: 'Yes. CPython serializes bytecode execution via the GIL.' },
        { text: 'Threads are useless for I/O-bound work',             correct: false, explain: 'Wrong. The GIL is released during I/O, so threads help I/O-bound work.' },
        { text: 'Multiprocessing sidesteps it with separate interpreters', correct: true,  explain: 'Yes. Each process has its own GIL, enabling true parallelism.' },
        { text: 'It makes all Python code thread-safe',               correct: false, explain: 'Wrong. The GIL does not protect your data structures from race conditions across operations.' },
      ],
    },
    {
      prompt: 'What does a Python <code>generator</code> (using <code>yield</code>) give you over returning a list?',
      type: 'single',
      options: [
        { text: 'Lazy, one-at-a-time evaluation with low memory', correct: true,  explain: 'Correct. Values are produced on demand — no need to materialize the whole sequence.' },
        { text: 'Faster random access by index',                 correct: false, explain: 'Wrong. Generators are forward-only; you cannot index them.' },
        { text: 'Automatic multithreading',                       correct: false, explain: 'Wrong. Generators are single-threaded cooperative iteration.' },
        { text: 'Type safety at runtime',                         correct: false, explain: 'Wrong. Generators have nothing to do with type checking.' },
      ],
    },

    // ── GENERAL TECH: TYPESCRIPT / JS ───────────────────────────────────────
    {
      prompt: 'In TypeScript, what is the difference between <code>unknown</code> and <code>any</code>?',
      type: 'single',
      options: [
        { text: 'unknown forces a type check/narrow before use; any disables checking', correct: true,  explain: 'Correct. unknown is the type-safe top type — you must narrow it. any opts out of the type system entirely.' },
        { text: 'They are identical aliases',         correct: false, explain: 'Wrong. any is unsafe; unknown is safe.' },
        { text: 'unknown only works with primitives', correct: false, explain: 'Wrong. unknown accepts any value, like any — the difference is at the use site.' },
        { text: 'any is stricter than unknown',       correct: false, explain: 'Wrong. It is the reverse — unknown is the stricter, safer one.' },
      ],
    },
    {
      prompt: 'What does <code>await</code> actually do to an <code>async</code> function?',
      type: 'single',
      options: [
        { text: 'Pauses that function and yields control back to the event loop', correct: true,  explain: 'Correct. await suspends the async function and lets other work run; it does NOT block the thread.' },
        { text: 'Blocks the entire JS thread until the promise resolves', correct: false, explain: 'Wrong. JS is single-threaded but await is non-blocking — the event loop keeps running.' },
        { text: 'Spawns a new OS thread',                       correct: false, explain: 'Wrong. No threads are created; it is cooperative concurrency.' },
        { text: 'Converts the promise into a synchronous value', correct: false, explain: 'Wrong. The function still returns a promise; only the inner code reads sequentially.' },
      ],
    },
    {
      prompt: 'Which of these are real differences between <code>==</code> and <code>===</code> in JavaScript?',
      type: 'multi',
      options: [
        { text: '== performs type coercion before comparing', correct: true,  explain: 'Yes. == coerces operands to a common type; === does not.' },
        { text: '=== checks type and value with no coercion',  correct: true,  explain: 'Yes. Strict equality requires same type and same value.' },
        { text: '== is faster at runtime in all engines',       correct: false, explain: 'Wrong. Performance is not the distinction, and coercion can be slower.' },
        { text: '0 == "" is true',                              correct: false, explain: 'Wrong. 0 == "" is actually false in JS — coercion rules are full of traps, which is why === is preferred.' },
      ],
    },

    // ── GENERAL TECH: ASYNC / CONCURRENCY ───────────────────────────────────
    {
      prompt: 'What problem does a <strong>race condition</strong> describe?',
      type: 'single',
      options: [
        { text: 'Outcome depends on the non-deterministic timing/order of concurrent operations', correct: true,  explain: 'Correct. When result depends on interleaving of concurrent access to shared state, you have a race.' },
        { text: 'A loop that runs too fast',          correct: false, explain: 'Wrong. Speed alone is not a race condition.' },
        { text: 'Two servers competing for a domain', correct: false, explain: 'Wrong. That is not the concurrency meaning.' },
        { text: 'A deadlock between two threads',     correct: false, explain: 'Wrong. Deadlock is a distinct problem — mutual waiting, not timing-dependent results.' },
      ],
    },
    {
      prompt: 'Which strategies help make a concurrent operation <strong>idempotent</strong>?',
      type: 'multi',
      options: [
        { text: 'Use a client-supplied idempotency key', correct: true,  explain: 'Yes. The server dedupes retries by key — the standard pattern for safe retries.' },
        { text: 'Upsert by a unique natural key',        correct: true,  explain: 'Yes. Writing by a stable key makes repeated writes converge to the same state.' },
        { text: 'Append a new row on every request',     correct: false, explain: 'Wrong. Blind appends make retries duplicate data — the opposite of idempotent.' },
        { text: 'Check-then-set without a transaction',  correct: false, explain: 'Wrong. The gap between check and set is itself a race; it does not guarantee idempotency.' },
      ],
    },

    // ── GENERAL TECH: SCALABILITY / SYSTEM DESIGN ───────────────────────────
    {
      prompt: 'What is the core difference between <strong>horizontal</strong> and <strong>vertical</strong> scaling?',
      type: 'single',
      options: [
        { text: 'Horizontal adds more machines; vertical makes one machine bigger', correct: true,  explain: 'Correct. Scale out (more nodes) vs scale up (bigger node). Horizontal scales further but needs statelessness/coordination.' },
        { text: 'Horizontal means a faster CPU; vertical means more nodes',         correct: false, explain: 'Wrong. That is backwards.' },
        { text: 'They are two names for the same thing',                            correct: false, explain: 'Wrong. They are fundamentally different approaches.' },
        { text: 'Vertical scaling has no upper limit',                              correct: false, explain: 'Wrong. Vertical scaling hits a hardware ceiling; horizontal is what scales further.' },
      ],
    },
    {
      prompt: 'Per the <strong>CAP theorem</strong>, what must a distributed system give up during a network partition?',
      type: 'single',
      options: [
        { text: 'Either consistency or availability', correct: true,  explain: 'Correct. Under a partition (P) you choose C or A — you cannot have both. No-partition systems can have both.' },
        { text: 'Partition tolerance',                correct: false, explain: 'Wrong. You cannot give up partition tolerance — partitions happen whether you like it or not.' },
        { text: 'All three at once',                  correct: false, explain: 'Wrong. The theorem says you sacrifice exactly one of C or A during a partition.' },
        { text: 'Durability',                         correct: false, explain: 'Wrong. Durability is not one of the CAP properties.' },
      ],
    },
    {
      prompt: 'Why does adding a <strong>cache</strong> in front of a database help scalability?',
      type: 'multi',
      options: [
        { text: 'It absorbs repeated reads, lowering DB load',   correct: true,  explain: 'Yes. Hot reads are served from cache, sparing the database.' },
        { text: 'It reduces latency for cache hits',             correct: true,  explain: 'Yes. In-memory reads are far faster than disk-backed DB queries.' },
        { text: 'It guarantees data is always fresh',            correct: false, explain: 'Wrong. Caches introduce staleness — invalidation is "one of the two hard problems".' },
        { text: 'It removes the need for a database',            correct: false, explain: 'Wrong. The cache is a layer in front; the DB remains the source of truth.' },
      ],
    },
    {
      prompt: 'What does a <strong>message queue</strong> (like SQS/Kafka) between services primarily buy you?',
      type: 'single',
      options: [
        { text: 'Decoupling + buffering so producers and consumers scale independently', correct: true,  explain: 'Correct. The queue absorbs bursts and lets each side fail/scale without taking the other down.' },
        { text: 'Lower latency than a direct synchronous call', correct: false, explain: 'Wrong. Queues add latency — the win is resilience and decoupling, not speed.' },
        { text: 'Strong consistency between services',          correct: false, explain: 'Wrong. Async messaging is eventually consistent by nature.' },
        { text: 'Automatic schema validation',                  correct: false, explain: 'Wrong. A queue moves bytes; schema enforcement is your job.' },
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
    const qOrig = QUESTIONS[questionIdx];
    const shuffled = [...qOrig.options].map((o, i) => ({...o, _origIdx: i}));
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const q = { ...qOrig, options: shuffled };
    const container = document.getElementById(containerId);
    let failCount = 0;

    function render() {
      container.innerHTML = '';
      const panel = document.createElement('div');
      panel.className = 'captcha-panel';
      panel.innerHTML = `
        <h2>🤖 Identity Verification — AWS Knowledge Check</h2>
        <p class="sub" style="font-size:0.62rem;color:#c8d6f8;line-height:1.9;">${q.prompt}</p>
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
        tile.innerHTML = `<span class="tile-label">${opt.text}</span>`;
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
          return `<div style="font-family:var(--font-display);font-size:0.52rem;color:#a0b0cc;line-height:1.9;">
            <span>${icon}</span> <strong style="color:${o.correct ? '#51cf66' : '#ff6b6b'}">${o.text}</strong>
            — ${o.explain}
          </div>`;
        }).join('');

        // Show help button after 2 failures
        if (failCount >= 2 && !document.getElementById(`${containerId}-help-btn`)) {
          const helpBtn = document.createElement('button');
          helpBtn.id = `${containerId}-help-btn`;
          helpBtn.textContent = '🆘 Need help? (Solve to unlock hints)';
          helpBtn.style.cssText = 'font-family:var(--font-display);margin-top:8px;font-size:0.62rem;background:#2a3a5c;border:1px solid #4a6a9a;color:#c8d6f8;padding:6px 12px;cursor:pointer;border-radius:var(--radius);';
          fb.after(helpBtn);
          helpBtn.addEventListener('click', () => {
            const a = Math.floor(Math.random() * 12) + 2;
            const b = Math.floor(Math.random() * 12) + 2;
            const answer = a * b;
            helpBtn.style.display = 'none';
            const mathDiv = document.createElement('div');
            mathDiv.style.cssText = 'margin-top:8px;display:flex;align-items:center;gap:8px;';
            mathDiv.innerHTML = `
              <span style="font-family:var(--font-display);color:#c8d6f8;font-size:0.6rem;">Solve: ${a} × ${b} =</span>
              <input id="${containerId}-math-input" type="number" style="font-family:var(--font-body);width:60px;padding:4px;background:#1a2a4c;border:1px solid #4a6a9a;color:#fff;border-radius:3px;">
              <button id="${containerId}-math-btn" style="font-family:var(--font-display);font-size:0.6rem;padding:4px 10px;background:#3a5a8c;border:none;color:#fff;border-radius:var(--radius);cursor:pointer;">Submit</button>
              <span id="${containerId}-math-err" style="font-family:var(--font-display);color:#ff6b6b;font-size:0.55rem;"></span>
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
  // Mashup of AWS IAM theater and Spanish state-portal (Cl@ve) bureaucracy — the
  // same "prove who you are before any trivial action" energy, two flavors at once.
  const VERIFY_STEPS = [
    'Conectando con la Sede Electrónica... hecho',
    'Validando certificado digital FNMT... hecho',
    'Querying Active Directory... done',
    'Comprobando DNIe en el registro... hecho',
    'Resolving group memberships (847 groups)...',
    'Verificando datos en el Padrón Municipal...',
    'Applying ABAC policies...',
    'Cotejando con la Agencia Tributaria... hecho',
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
    'Registrando trámite en el expediente Nº ES-2026-FLAP-0042/IAM... hecho',
    'Justificante de autorización disponible en la carpeta ciudadana ✓',
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
          hint.textContent  = 'ℹ️ Esto es normal. Cl@ve realiza una doble verificación de confianza cero (zero-trust). Vuelva a introducir el código.';
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
