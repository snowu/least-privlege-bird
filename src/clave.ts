// ── CLAVE SSO MOCK FLOW ────────────────────────────────────────────────────────
// Exposes: Clave.startLogin(playerName, onSuccess)
//          Clave.startScoreSubmit(playerName, score, onSuccess)

export const Clave = (() => {

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

    // ── NETWORKING / HTTP ───────────────────────────────────────────────────
    {
      prompt: 'What does an HTTP <code>301</code> tell the client, vs a <code>302</code>?',
      type: 'single',
      options: [
        { text: '301 = permanent redirect (cacheable); 302 = temporary', correct: true,  explain: 'Correct. 301 invites clients/proxies to cache and update bookmarks; 302 says "just this once".' },
        { text: 'They are interchangeable',                  correct: false, explain: 'Wrong. Caching behaviour differs — a wrong 301 is sticky and painful to undo.' },
        { text: '301 means server error',                    correct: false, explain: 'Wrong. 3xx is redirection; 5xx is server error.' },
        { text: '302 forces HTTPS',                          correct: false, explain: 'Wrong. Redirect status has nothing to do with the scheme by itself.' },
      ],
    },
    {
      prompt: 'Which are true of <strong>TCP</strong> vs <strong>UDP</strong>?',
      type: 'multi',
      options: [
        { text: 'TCP guarantees ordered, reliable delivery', correct: true,  explain: 'Yes. Sequencing + retransmission give ordered, reliable bytes.' },
        { text: 'UDP has lower overhead and no handshake',   correct: true,  explain: 'Yes. Fire-and-forget — great for video/games/DNS.' },
        { text: 'UDP guarantees delivery order',             correct: false, explain: 'Wrong. UDP makes no ordering or delivery guarantees.' },
        { text: 'TCP is connectionless',                     correct: false, explain: 'Wrong. TCP is connection-oriented; UDP is connectionless.' },
      ],
    },
    {
      prompt: 'A DNS record\'s <strong>TTL</strong> controls what?',
      type: 'single',
      options: [
        { text: 'How long resolvers may cache the record before re-querying', correct: true,  explain: 'Correct. Low TTL = faster propagation but more queries; high TTL = the opposite.' },
        { text: 'The maximum hops a packet can take',        correct: false, explain: 'Wrong — that is the IP-packet TTL, a different field entirely.' },
        { text: 'How long the domain registration lasts',    correct: false, explain: 'Wrong. Registration term is unrelated to record TTL.' },
        { text: 'The DNSSEC signature validity',             correct: false, explain: 'Wrong. Signature lifetimes are separate from record TTL.' },
      ],
    },

    // ── GIT / TOOLING ───────────────────────────────────────────────────────
    {
      prompt: 'What is the difference between <code>git merge</code> and <code>git rebase</code>?',
      type: 'single',
      options: [
        { text: 'Merge preserves history with a merge commit; rebase rewrites commits onto a new base', correct: true,  explain: 'Correct. Rebase gives linear history but rewrites SHAs — never rebase shared/pushed branches.' },
        { text: 'They produce identical history',            correct: false, explain: 'Wrong. Merge keeps the branch topology; rebase linearizes it.' },
        { text: 'Rebase deletes the remote branch',          correct: false, explain: 'Wrong. Rebase only re-applies commits locally.' },
        { text: 'Merge cannot cause conflicts',              correct: false, explain: 'Wrong. Both can conflict — they touch the same lines.' },
      ],
    },
    {
      prompt: 'Which <code>git reset</code> modes leave your <strong>working tree changes intact</strong>?',
      type: 'multi',
      options: [
        { text: '--soft (moves HEAD, keeps index + tree)',  correct: true,  explain: 'Yes. Soft only moves the branch pointer; staged changes stay staged.' },
        { text: '--mixed (default; keeps tree, unstages)',   correct: true,  explain: 'Yes. Mixed resets the index but leaves the working tree.' },
        { text: '--hard (discards index + tree)',            correct: false, explain: 'Wrong. Hard throws away working-tree changes — the dangerous one.' },
        { text: '--keep on a dirty conflicting file',        correct: false, explain: 'Wrong. --keep aborts rather than clobbering, but does not preserve conflicting local edits.' },
      ],
    },

    // ── DATA STRUCTURES / COMPLEXITY ────────────────────────────────────────
    {
      prompt: 'Average-case lookup complexity of a well-distributed <strong>hash table</strong>?',
      type: 'single',
      options: [
        { text: 'O(1)',       correct: true,  explain: 'Correct. Constant on average; worst case O(n) under pathological collisions.' },
        { text: 'O(log n)',   correct: false, explain: 'Wrong. That is a balanced BST. Hash tables are O(1) average.' },
        { text: 'O(n)',       correct: false, explain: 'Wrong — that is the degenerate worst case, not the average.' },
        { text: 'O(n log n)', correct: false, explain: 'Wrong. That is comparison sorting, not a lookup.' },
      ],
    },
    {
      prompt: 'Which operations are <strong>O(1)</strong> on a typical dynamic array (vector/list)?',
      type: 'multi',
      options: [
        { text: 'Index access by position',                  correct: true,  explain: 'Yes. Random access is constant time — contiguous memory.' },
        { text: 'Amortized append to the end',               correct: true,  explain: 'Yes. Amortized O(1) thanks to geometric growth, despite occasional resize.' },
        { text: 'Insert at the front',                        correct: false, explain: 'Wrong. Front insert shifts every element — O(n).' },
        { text: 'Search for an arbitrary value',              correct: false, explain: 'Wrong. Unsorted linear search is O(n).' },
      ],
    },

    // ── DATABASES ───────────────────────────────────────────────────────────
    {
      prompt: 'A database <strong>B-tree index</strong> on a column primarily speeds up what?',
      type: 'single',
      options: [
        { text: 'Lookups, range scans and ordered reads on that column', correct: true,  explain: 'Correct. B-trees keep keys sorted, so equality, ranges and ORDER BY all benefit.' },
        { text: 'Writes and bulk inserts',                  correct: false, explain: 'Wrong. Indexes slow writes — every insert must maintain the tree.' },
        { text: 'Random unindexed full-table scans',         correct: false, explain: 'Wrong. A full scan ignores the index entirely.' },
        { text: 'Hash equality only, never ranges',          correct: false, explain: 'Wrong — that describes a hash index; B-trees do ranges too.' },
      ],
    },
    {
      prompt: 'Which guarantees do the <strong>ACID</strong> properties cover?',
      type: 'multi',
      options: [
        { text: 'Atomicity — all-or-nothing transactions',  correct: true,  explain: 'Yes. A transaction either fully commits or fully rolls back.' },
        { text: 'Isolation — concurrent txns do not corrupt each other', correct: true,  explain: 'Yes. Isolation levels control visibility of in-flight changes.' },
        { text: 'Durability — committed data survives crashes', correct: true,  explain: 'Yes. Once committed, it is on stable storage (WAL/fsync).' },
        { text: 'Availability — the DB is always reachable', correct: false, explain: 'Wrong. Availability is a CAP property, not the A in ACID.' },
      ],
    },
    {
      prompt: 'What does a <code>LEFT JOIN</code> return that an <code>INNER JOIN</code> does not?',
      type: 'single',
      options: [
        { text: 'Rows from the left table with no match on the right (filled with NULLs)', correct: true,  explain: 'Correct. LEFT keeps every left row; unmatched right columns become NULL.' },
        { text: 'Only rows present in both tables',          correct: false, explain: 'Wrong — that is exactly what INNER JOIN does.' },
        { text: 'The cartesian product of both tables',      correct: false, explain: 'Wrong — that is a CROSS JOIN.' },
        { text: 'Rows from the right table only',            correct: false, explain: 'Wrong — that would be a RIGHT JOIN, and even then it keeps the right side.' },
      ],
    },

    // ── OS / SYSTEMS ────────────────────────────────────────────────────────
    {
      prompt: 'What is the core difference between a <strong>process</strong> and a <strong>thread</strong>?',
      type: 'single',
      options: [
        { text: 'Threads share the process address space; processes have isolated memory', correct: true,  explain: 'Correct. Threads share heap/globals (cheap, but needs synchronization); processes are isolated.' },
        { text: 'Threads are always slower than processes',  correct: false, explain: 'Wrong. Threads are lighter to create and context-switch.' },
        { text: 'A process can only ever have one thread',    correct: false, explain: 'Wrong. A process can host many threads.' },
        { text: 'Processes share memory by default',          correct: false, explain: 'Wrong — that is threads; processes need explicit IPC/shared memory.' },
      ],
    },
    {
      prompt: 'Which conditions are required for a classic <strong>deadlock</strong>?',
      type: 'multi',
      options: [
        { text: 'Mutual exclusion on resources',             correct: true,  explain: 'Yes. Resources held in a non-shareable mode.' },
        { text: 'Hold-and-wait',                             correct: true,  explain: 'Yes. A thread holds one resource while waiting for another.' },
        { text: 'Circular wait',                             correct: true,  explain: 'Yes. A cycle in the wait-for graph closes the trap.' },
        { text: 'Preemptible resource allocation',           correct: false, explain: 'Wrong. Deadlock needs NO preemption — preemption actually breaks it.' },
      ],
    },

    // ── CONTAINERS ──────────────────────────────────────────────────────────
    {
      prompt: 'How do <strong>containers</strong> differ from <strong>virtual machines</strong>?',
      type: 'single',
      options: [
        { text: 'Containers share the host kernel; VMs run a full guest OS', correct: true,  explain: 'Correct. Containers isolate via namespaces/cgroups — lighter, faster boot, no separate kernel.' },
        { text: 'Containers each run their own kernel',       correct: false, explain: 'Wrong — that is a VM. Containers share the host kernel.' },
        { text: 'VMs are always smaller than containers',     correct: false, explain: 'Wrong. VM images carry a full OS — usually much larger.' },
        { text: 'Containers cannot be resource-limited',      correct: false, explain: 'Wrong. cgroups cap CPU/memory per container.' },
      ],
    },

    // ── SECURITY / CRYPTO ───────────────────────────────────────────────────
    {
      prompt: 'Why should passwords be stored with a <strong>salted hash</strong> (bcrypt/argon2), not encrypted?',
      type: 'single',
      options: [
        { text: 'Hashing is one-way + salt defeats rainbow tables; encryption is reversible if the key leaks', correct: true,  explain: 'Correct. You never need the plaintext back, and a slow salted hash resists precomputation and cracking.' },
        { text: 'Encryption is too slow to compute',          correct: false, explain: 'Wrong. The point is reversibility, not speed — and slow KDFs are intentional.' },
        { text: 'Hashes take less storage',                   correct: false, explain: 'Wrong. Storage size is not the reason.' },
        { text: 'Salts make the hash reversible',             correct: false, explain: 'Wrong. Salts add uniqueness; they do not make hashing reversible.' },
      ],
    },
    {
      prompt: 'Which are properties of <strong>asymmetric (public-key)</strong> cryptography?',
      type: 'multi',
      options: [
        { text: 'A public key encrypts; the private key decrypts', correct: true,  explain: 'Yes. Anyone can encrypt to you; only your private key reads it.' },
        { text: 'A private key signs; the public key verifies', correct: true,  explain: 'Yes. Signatures prove origin/integrity without sharing the secret.' },
        { text: 'Both parties must share the same secret key', correct: false, explain: 'Wrong — that is symmetric crypto.' },
        { text: 'It is typically faster than symmetric crypto', correct: false, explain: 'Wrong. Asymmetric is slower; TLS uses it only to exchange a symmetric key.' },
      ],
    },
    {
      prompt: 'What primarily causes a <strong>Lambda cold start</strong>?',
      type: 'single',
      options: [
        { text: 'AWS provisioning a fresh execution environment before the first invocation', correct: true,  explain: 'Correct. A cold start is the overhead of initializing a new runtime + your code.' },
        { text: 'The function exceeding its memory limit',          correct: false, explain: 'Wrong. That triggers an out-of-memory error, not a cold start.' },
        { text: 'DNS resolution timing out',                        correct: false, explain: 'Wrong. DNS issues cause connection errors, not cold starts.' },
        { text: 'The deployment package exceeding 256 KB',          correct: false, explain: 'Wrong. That is a direct-upload size limit, unrelated to cold starts.' },
      ],
    },
    {
      prompt: 'In <strong>DynamoDB</strong>, what is the role of the partition key?',
      type: 'single',
      options: [
        { text: 'It determines which physical partition stores the item', correct: true,  explain: 'Correct. DynamoDB hashes the partition key to decide where the item lives.' },
        { text: 'It enforces uniqueness across the whole table',     correct: false, explain: 'Wrong. Only partition+sort key together must be unique (if a sort key exists).' },
        { text: 'It defines the item\'s TTL',                        correct: false, explain: 'Wrong. TTL is a separate attribute you configure independently.' },
        { text: 'It controls IAM access to the table',               correct: false, explain: 'Wrong. Access is controlled via IAM policies, not the key schema.' },
      ],
    },
    {
      prompt: 'What does putting a <strong>CloudFront</strong> distribution in front of an S3 bucket give you?',
      type: 'multi',
      options: [
        { text: 'Content cached closer to users at edge locations',  correct: true,  explain: 'Yes — that is the core CDN benefit: lower latency via edge caching.' },
        { text: 'Automatic encryption of objects at rest in S3',     correct: false, explain: 'Wrong. That is S3 server-side encryption, unrelated to CloudFront.' },
        { text: 'Reduced direct load on the origin bucket',          correct: true,  explain: 'Yes — cached responses are served from the edge without hitting S3.' },
        { text: 'HTTPS on a custom domain via ACM certificates',     correct: true,  explain: 'Yes — CloudFront integrates with ACM for custom-domain TLS.' },
      ],
    },
    {
      prompt: 'What makes a <strong>VPC subnet</strong> "public"?',
      type: 'single',
      options: [
        { text: 'Its route table sends 0.0.0.0/0 to an Internet Gateway', correct: true,  explain: 'Correct. The route to an IGW is what makes a subnet public — nothing else.' },
        { text: 'Instances in it get public IPs automatically',      correct: false, explain: 'Wrong. That\'s a per-instance/subnet setting, not the defining property.' },
        { text: 'It has no Network ACL attached',                    correct: false, explain: 'Wrong. Every subnet has a NACL — the default one if none is specified.' },
        { text: 'It lives in Availability Zone "a"',                 correct: false, explain: 'Wrong. AZ placement has nothing to do with public/private routing.' },
      ],
    },
    {
      prompt: 'What is <strong>envelope encryption</strong> (as used by AWS KMS)?',
      type: 'single',
      options: [
        { text: 'Encrypting data with a data key, then encrypting that key with a master key', correct: true, explain: 'Correct. This avoids sending large payloads to KMS and limits exposure of the master key.' },
        { text: 'Wrapping an HTTP request in an extra TLS layer',    correct: false, explain: 'Wrong. That would just be nested TLS, not envelope encryption.' },
        { text: 'Storing encrypted data in a special "envelope" bucket', correct: false, explain: 'Wrong. "Envelope" refers to the key-wrapping technique, not a storage location.' },
        { text: 'Encrypting only a message\'s headers, not its body', correct: false, explain: 'Wrong — it\'s the opposite: the body (data) is what the data key encrypts.' },
      ],
    },
    {
      prompt: 'A <strong>CloudWatch Alarm</strong> shows state <code>INSUFFICIENT_DATA</code>. What does that mean?',
      type: 'single',
      options: [
        { text: 'It doesn\'t yet have enough data points to determine OK or ALARM', correct: true, explain: 'Correct — common right after creation, or when the metric stops reporting.' },
        { text: 'The monitored resource was deleted',                correct: false, explain: 'Wrong. Deletion just stops new data; this is a distinct named state.' },
        { text: 'Its threshold has been breached',                   correct: false, explain: 'Wrong. A breach moves the alarm to ALARM state.' },
        { text: 'Its alarm action failed to execute',                correct: false, explain: 'Wrong. Action failures are reported separately from alarm state.' },
      ],
    },
    {
      prompt: 'Which <strong>Route 53</strong> routing policies route users toward the lowest-latency endpoint?',
      type: 'multi',
      options: [
        { text: 'Latency-based routing',                             correct: true,  explain: 'Yes — it routes based on measured latency between users and AWS regions.' },
        { text: 'Geolocation routing',                               correct: false, explain: 'Geolocation routes by the user\'s location, not measured latency — close, but not the same.' },
        { text: 'Weighted routing',                                  correct: false, explain: 'Weighted routing splits traffic by configured percentages, ignoring latency.' },
        { text: 'Geoproximity routing (with bias)',                  correct: true,  explain: 'Yes — geoproximity can shift traffic toward closer/biased resources, improving latency.' },
      ],
    },
    {
      prompt: 'An <strong>Auto Scaling Group</strong> target-tracks CPU at 50%. Average CPU climbs to 80%. What happens?',
      type: 'single',
      options: [
        { text: 'It launches more instances to bring the average back toward 50%', correct: true, explain: 'Correct — target tracking adjusts capacity to keep the metric near its target.' },
        { text: 'It terminates instances to reduce load',            correct: false, explain: 'Wrong — that would push CPU even higher, the opposite of the goal.' },
        { text: 'It emails an admin and waits for approval',         correct: false, explain: 'Wrong — that describes a manual workflow, not target tracking.' },
        { text: 'Nothing — target tracking only watches memory',     correct: false, explain: 'Wrong — CPU utilization is one of the most common target-tracking metrics.' },
      ],
    },
    {
      prompt: 'What is the core difference between <strong>ECS on EC2</strong> and <strong>ECS on Fargate</strong>?',
      type: 'single',
      options: [
        { text: 'Fargate removes the need to provision and manage the underlying servers', correct: true, explain: 'Correct — with Fargate you just specify CPU/memory per task; AWS runs it.' },
        { text: 'Fargate only supports Windows containers',          correct: false, explain: 'Wrong — Fargate supports both Linux and Windows containers.' },
        { text: 'ECS on EC2 cannot use load balancers',              correct: false, explain: 'Wrong — both launch types integrate with ALBs/NLBs.' },
        { text: 'Fargate tasks cannot reach VPC resources',          correct: false, explain: 'Wrong — Fargate tasks run inside your VPC just like EC2-backed ones.' },
      ],
    },
    {
      prompt: 'What problem do <strong>Step Functions</strong> primarily solve?',
      type: 'single',
      options: [
        { text: 'Orchestrating multi-step workflows across services with retries and branching', correct: true, explain: 'Correct — they coordinate state machines of tasks, including error handling and parallel branches.' },
        { text: 'Storing large binary objects cheaply',              correct: false, explain: 'Wrong — that\'s S3\'s job.' },
        { text: 'Running scheduled cron-like jobs only',             correct: false, explain: 'Wrong — that\'s closer to EventBridge Scheduler; Step Functions orchestrates workflows.' },
        { text: 'Providing a managed relational database',          correct: false, explain: 'Wrong — that would be RDS/Aurora.' },
      ],
    },
    {
      prompt: 'Why do <strong>Docker images</strong> use a layered filesystem?',
      type: 'multi',
      options: [
        { text: 'Layers can be cached and reused across builds',     correct: true,  explain: 'Yes — unchanged layers are cached, speeding rebuilds and saving storage/transfer.' },
        { text: 'Each layer runs in its own isolated container',     correct: false, explain: 'Wrong — layers are filesystem diffs, not running containers.' },
        { text: 'Multiple images can share common base layers on disk', correct: true, explain: 'Yes — a shared base layer (e.g. a common OS) is stored once and reused.' },
        { text: 'They automatically scan for vulnerabilities on every build', correct: false, explain: 'Wrong — that requires a separate scanning tool/service.' },
      ],
    },
    {
      prompt: 'In <strong>Kubernetes</strong>, what is a Pod?',
      type: 'single',
      options: [
        { text: 'The smallest deployable unit, wrapping one or more tightly-coupled containers', correct: true, explain: 'Correct — containers in a Pod share a network namespace and storage.' },
        { text: 'A physical worker machine in the cluster',          correct: false, explain: 'Wrong — that\'s a Node.' },
        { text: 'A persistent storage volume',                       correct: false, explain: 'Wrong — that\'s a PersistentVolume.' },
        { text: 'A load balancer routing traffic into the cluster',  correct: false, explain: 'Wrong — that\'s an Ingress or a Service of type LoadBalancer.' },
      ],
    },
    {
      prompt: 'What is the difference between a Kubernetes <strong>Deployment</strong> and a <strong>Service</strong>?',
      type: 'single',
      options: [
        { text: 'A Deployment manages Pod replicas and rollouts; a Service gives them stable networking', correct: true, explain: 'Correct — Deployments handle "what runs", Services handle "how to reach it".' },
        { text: 'They are interchangeable names for the same resource', correct: false, explain: 'Wrong — they serve very different purposes.' },
        { text: 'A Service schedules Pods onto Nodes',                correct: false, explain: 'Wrong — that\'s the scheduler\'s job, tied to Deployments/ReplicaSets.' },
        { text: 'A Deployment only works alongside StatefulSets',    correct: false, explain: 'Wrong — Deployments and StatefulSets are separate, parallel concepts.' },
      ],
    },
    {
      prompt: 'A file has permissions <code>rwxr-xr--</code>. What can the <strong>group</strong> do with it?',
      type: 'single',
      options: [
        { text: 'Read and execute, but not write',                   correct: true,  explain: 'Correct — the middle triplet "r-x" applies to the group.' },
        { text: 'Read, write, and execute',                          correct: false, explain: 'Wrong — that\'s the owner\'s permissions (first triplet).' },
        { text: 'Read only',                                         correct: false, explain: 'Wrong — the group also has execute ("x") permission.' },
        { text: 'Nothing — the group has no access',                 correct: false, explain: 'Wrong — "r-x" grants the group read and execute.' },
      ],
    },
    {
      prompt: 'What does the regular expression <code>^foo.*bar$</code> match?',
      type: 'single',
      options: [
        { text: 'A line starting with "foo", ending with "bar", anything in between', correct: true, explain: 'Correct — ^ anchors the start, $ the end, .* matches any run of characters.' },
        { text: 'Any line containing both "foo" and "bar" in any order', correct: false, explain: 'Wrong — the anchors and ordering make this position- and order-specific.' },
        { text: 'A line that is exactly "foobar"',                   correct: false, explain: 'Wrong — .* permits (but doesn\'t require) characters between them.' },
        { text: 'Lines that do NOT contain "foo" or "bar"',          correct: false, explain: 'Wrong — that needs negation syntax, not present here.' },
      ],
    },
    {
      prompt: 'What is the difference between <code>Cache-Control: no-cache</code> and <code>no-store</code>?',
      type: 'single',
      options: [
        { text: '"no-cache" requires revalidation before use; "no-store" forbids caching entirely', correct: true, explain: 'Correct — "no-cache" can still be cached but must be revalidated; "no-store" must never be persisted anywhere.' },
        { text: 'They are synonyms — both block all caching',        correct: false, explain: 'Wrong — "no-cache" is more permissive than its name suggests.' },
        { text: '"no-store" allows client caching but blocks proxy caching', correct: false, explain: 'Wrong — "no-store" forbids storing anywhere, client or proxy.' },
        { text: '"no-cache" only applies to images and static assets', correct: false, explain: 'Wrong — these directives apply to any cacheable response.' },
      ],
    },
    {
      prompt: 'What does <strong>O(log n)</strong> complexity typically tell you about an algorithm?',
      type: 'single',
      options: [
        { text: 'It roughly halves (or divides) the problem with each step, like binary search', correct: true, explain: 'Correct — logarithmic growth comes from repeatedly dividing the input.' },
        { text: 'It must check every element exactly once',          correct: false, explain: 'Wrong — that\'s O(n), linear time.' },
        { text: 'Its runtime is constant regardless of input size',  correct: false, explain: 'Wrong — that\'s O(1).' },
        { text: 'Its runtime doubles with every extra element',      correct: false, explain: 'Wrong — that would be exponential, O(2^n).' },
      ],
    },
    {
      prompt: 'What does a <strong>CI/CD pipeline</strong> aim to do?',
      type: 'multi',
      options: [
        { text: 'Automatically build and test code on every change', correct: true,  explain: 'Yes — continuous integration catches issues early by validating every change.' },
        { text: 'Automate and standardize the path from commit to deployment', correct: true, explain: 'Yes — continuous delivery/deployment makes releases repeatable and lower-risk.' },
        { text: 'Replace the need for code review',                  correct: false, explain: 'Wrong — pipelines complement review; they don\'t replace human judgment.' },
        { text: 'Guarantee zero bugs in production',                 correct: false, explain: 'Wrong — pipelines reduce risk, but can\'t promise perfection.' },
      ],
    },
    {
      prompt: 'What is the purpose of a <strong>Terraform state file</strong>?',
      type: 'single',
      options: [
        { text: 'It tracks the real-world resources Terraform manages and maps them to your config', correct: true, explain: 'Correct — state lets Terraform know what already exists so it can plan accurate changes.' },
        { text: 'It stores your cloud provider credentials',         correct: false, explain: 'Wrong — credentials are configured separately (env vars, profiles, etc).' },
        { text: 'It is a human-readable changelog of deployments',   correct: false, explain: 'Wrong — that role belongs to a CI/CD audit log, not Terraform state.' },
        { text: 'It compiles your HCL into a binary executable',     correct: false, explain: 'Wrong — Terraform interprets HCL directly; there\'s no compilation step.' },
      ],
    },
    {
      prompt: 'In <strong>distributed tracing</strong>, what does a "span" represent?',
      type: 'single',
      options: [
        { text: 'A single unit of work (e.g. one service call) within a larger trace', correct: true, explain: 'Correct — a trace is a tree of spans showing how a request moved through services.' },
        { text: 'The total time a server has been running',          correct: false, explain: 'Wrong — that\'s uptime, unrelated to tracing.' },
        { text: 'A region spanning multiple Availability Zones',     correct: false, explain: 'Wrong — that\'s a networking concept, not a tracing one.' },
        { text: 'A scheduled maintenance window',                    correct: false, explain: 'Wrong — unrelated to observability spans.' },
      ],
    },
    {
      prompt: 'Why is <strong>Redis</strong> commonly used as a cache in front of a database?',
      type: 'multi',
      options: [
        { text: 'It stores data in memory, making reads very fast',  correct: true,  explain: 'Yes — in-memory storage is what gives Redis its speed advantage.' },
        { text: 'It reduces repeated load on the primary database',  correct: true,  explain: 'Yes — serving hot data from cache means fewer queries hit the DB.' },
        { text: 'It guarantees data is never lost on restart',       correct: false, explain: 'Wrong — Redis is in-memory by default and can lose data; persistence is optional.' },
        { text: 'It automatically normalizes your schema',          correct: false, explain: 'Wrong — Redis is a key-value store; schema design is entirely up to you.' },
      ],
    },
    {
      prompt: 'What is a key advantage of <strong>GraphQL</strong> over a typical REST API?',
      type: 'single',
      options: [
        { text: 'Clients can request exactly the fields they need in a single query', correct: true, explain: 'Correct — this avoids the over- and under-fetching common with fixed REST endpoints.' },
        { text: 'It is always faster than REST regardless of use case', correct: false, explain: 'Wrong — performance depends on implementation; GraphQL adds its own overhead.' },
        { text: 'It eliminates the need for authentication',         correct: false, explain: 'Wrong — GraphQL APIs need auth just like REST ones.' },
        { text: 'It only works over WebSockets',                     correct: false, explain: 'Wrong — GraphQL typically runs over plain HTTP; subscriptions may use WebSockets.' },
      ],
    },
    {
      prompt: 'What does a <strong>Cross-Site Scripting (XSS)</strong> attack typically achieve?',
      type: 'single',
      options: [
        { text: 'Running attacker-supplied script in another user\'s browser session', correct: true, explain: 'Correct — XSS injects malicious script that executes in the victim\'s browser context.' },
        { text: 'Flooding a server with traffic until it crashes',   correct: false, explain: 'Wrong — that describes a DoS/DDoS attack.' },
        { text: 'Guessing a password through repeated login attempts', correct: false, explain: 'Wrong — that\'s brute-forcing/credential stuffing.' },
        { text: 'Silently intercepting traffic between two parties', correct: false, explain: 'Wrong — that\'s a man-in-the-middle attack.' },
      ],
    },
    {
      prompt: 'What does a <strong>CSRF token</strong> protect against?',
      type: 'single',
      options: [
        { text: 'A malicious site tricking a logged-in user\'s browser into making unwanted requests', correct: true, explain: 'Correct — the token proves the request truly originated from your own page, not a forged one.' },
        { text: 'SQL injection through form fields',                 correct: false, explain: 'Wrong — that needs input sanitization/parameterized queries.' },
        { text: 'Brute-force password guessing',                     correct: false, explain: 'Wrong — that\'s mitigated by rate limiting and lockouts.' },
        { text: 'Eavesdropping on network traffic',                  correct: false, explain: 'Wrong — that\'s what TLS/HTTPS protects against.' },
      ],
    },
    {
      prompt: 'What is the most reliable defense against <strong>SQL injection</strong>?',
      type: 'single',
      options: [
        { text: 'Using parameterized queries / prepared statements', correct: true,  explain: 'Correct — binding parameters separates code from data, so input can never alter query structure.' },
        { text: 'Escaping quotes in the UI layer',                   correct: false, explain: 'Wrong — UI-layer escaping doesn\'t protect the actual database query.' },
        { text: 'Storing the DB password in an environment variable', correct: false, explain: 'Wrong — good secrets hygiene, but irrelevant to injection.' },
        { text: 'Using a NoSQL database instead',                    correct: false, explain: 'Wrong — NoSQL databases have their own injection risks (e.g. operator injection).' },
      ],
    },
    {
      prompt: 'What distinguishes a <strong>unit test</strong> from an <strong>integration test</strong>?',
      type: 'single',
      options: [
        { text: 'A unit test isolates a small piece of code; an integration test checks multiple parts working together', correct: true, explain: 'Correct — unit tests check components in isolation (often with mocks); integration tests check real interactions.' },
        { text: 'Unit tests run in production; integration tests run locally', correct: false, explain: 'Wrong — environment doesn\'t define either type.' },
        { text: 'Integration tests are always faster than unit tests', correct: false, explain: 'Wrong — they\'re usually slower, due to real dependencies (DBs, networks).' },
        { text: 'Unit tests require a running server; integration tests don\'t', correct: false, explain: 'Wrong — if anything, it tends to be the other way around.' },
      ],
    },
    {
      prompt: 'What is true about a <strong>JWT (JSON Web Token)</strong>?',
      type: 'multi',
      options: [
        { text: 'Its payload is base64-encoded, not encrypted, by default', correct: true, explain: 'Yes — anyone can decode a standard JWT payload; the signature only proves integrity.' },
        { text: 'A valid signature proves it was issued by a trusted party and untampered', correct: true, explain: 'Yes — that is the core guarantee a signature provides.' },
        { text: 'JWTs cannot be used for stateless authentication', correct: false, explain: 'Wrong — stateless auth is one of JWT\'s most common uses.' },
        { text: 'Expired JWTs are automatically rejected by any server that sees them', correct: false, explain: 'Wrong — the server must explicitly check the "exp" claim; nothing happens automatically.' },
      ],
    },
    {
      prompt: 'What problem does <strong>OAuth 2.0</strong> primarily solve?',
      type: 'single',
      options: [
        { text: 'Letting a user grant a third-party app limited access without sharing their password', correct: true, explain: 'Correct — OAuth issues scoped, revocable access tokens instead of handing out credentials.' },
        { text: 'Encrypting data stored in a database',              correct: false, explain: 'Wrong — that\'s a data-at-rest concern, unrelated to OAuth.' },
        { text: 'Compressing HTTP responses for faster delivery',    correct: false, explain: 'Wrong — that\'s gzip/Brotli, a transport optimization.' },
        { text: 'Load-balancing requests across multiple servers',   correct: false, explain: 'Wrong — that\'s a load balancer\'s job, not an auth protocol\'s.' },
      ],
    },
    {
      prompt: 'What is <strong>database sharding</strong>?',
      type: 'single',
      options: [
        { text: 'Splitting a dataset across multiple databases/servers, often by a key', correct: true, explain: 'Correct — sharding distributes data horizontally to scale beyond a single machine.' },
        { text: 'Creating read replicas of the same data',           correct: false, explain: 'Wrong — that\'s replication, which copies (not splits) data.' },
        { text: 'Compressing rows to save disk space',               correct: false, explain: 'Wrong — a storage optimization, unrelated to sharding.' },
        { text: 'Encrypting individual table columns',               correct: false, explain: 'Wrong — that\'s column-level encryption, a security feature.' },
      ],
    },
    {
      prompt: 'During a <strong>TLS handshake</strong>, what gets negotiated?',
      type: 'multi',
      options: [
        { text: 'Which encryption algorithms (cipher suite) both sides will use', correct: true, explain: 'Yes — cipher-suite negotiation picks the algorithms for the session.' },
        { text: 'A shared symmetric session key',                    correct: true,  explain: 'Yes — asymmetric crypto briefly establishes a fast symmetric key for the rest of the session.' },
        { text: 'The DNS record for the domain',                     correct: false, explain: 'Wrong — DNS resolution happens before TLS even starts.' },
        { text: 'The HTTP status code of the first response',        correct: false, explain: 'Wrong — that\'s decided by the application after the handshake completes.' },
      ],
    },
    {
      prompt: 'Which HTTP methods are defined as <strong>idempotent</strong> (repeating has the same effect as doing it once)?',
      type: 'multi',
      options: [
        { text: 'GET',    correct: true,  explain: 'Yes — GET should never change server state, so repeating it is harmless.' },
        { text: 'PUT',    correct: true,  explain: 'Yes — PUT replaces a resource with the given representation; repeating yields the same result.' },
        { text: 'POST',   correct: false, explain: 'Wrong — POST typically creates a new resource each time (e.g. duplicate orders).' },
        { text: 'DELETE', correct: true,  explain: 'Yes — deleting an already-deleted resource still leaves it deleted; the end state matches.' },
      ],
    },
    {
      prompt: 'What is the core difference between the <strong>stack</strong> and the <strong>heap</strong> in memory management?',
      type: 'single',
      options: [
        { text: 'The stack holds short-lived, function-scoped data cleaned up automatically; the heap holds longer-lived data managed manually or by a GC', correct: true, explain: 'Correct — stack frames pop on return; heap allocations persist until freed or collected.' },
        { text: 'The heap is faster to allocate from than the stack', correct: false, explain: 'Wrong — stack allocation is typically just a pointer bump, faster than heap allocation.' },
        { text: 'The stack has no size limit; the heap does',        correct: false, explain: 'Wrong — in practice it\'s the opposite; stacks have a (often smaller) fixed limit, hence "stack overflow".' },
        { text: 'Only multi-threaded programs use the heap',         correct: false, explain: 'Wrong — any program with dynamic allocation uses the heap, threaded or not.' },
      ],
    },
    {
      prompt: 'What happens to a recursive function that never reaches its <strong>base case</strong>?',
      type: 'single',
      options: [
        { text: 'It keeps calling itself until it exhausts the call stack (stack overflow)', correct: true, explain: 'Correct — without a base case there is no terminating condition, and each call consumes a stack frame.' },
        { text: 'It silently returns undefined/null',                correct: false, explain: 'Wrong — it keeps executing rather than quietly stopping.' },
        { text: 'The compiler rejects it at build time',             correct: false, explain: 'Wrong — most languages can\'t statically prove termination, so this compiles fine and fails at runtime.' },
        { text: 'It automatically turns itself into a loop',         correct: false, explain: 'Wrong — that optimization (tail-call elimination) only applies in specific cases and languages.' },
      ],
    },
    {
      prompt: 'What does a "least connections" load-balancing algorithm do?',
      type: 'single',
      options: [
        { text: 'Sends each new request to the backend currently handling the fewest active connections', correct: true, explain: 'Correct — this helps even out load when requests vary widely in duration.' },
        { text: 'Always routes to the geographically closest server', correct: false, explain: 'Wrong — that\'s geo-based or latency-based routing.' },
        { text: 'Sends requests in a fixed repeating order',         correct: false, explain: 'Wrong — that\'s round robin.' },
        { text: 'Picks a server at random for every request',        correct: false, explain: 'Wrong — that\'s a random algorithm, a different (simpler) strategy.' },
      ],
    },
  ];

  // Pick two distinct random questions, fresh every login (not once per page load).
  // Bag-shuffle the full index list and take the first two so the pre-login and
  // post-game captchas never repeat the same question within one session, and the
  // pair varies run-to-run.
  let _picks = [0, 1];
  function _rollPicks() {
    const idx = Array.from({length: QUESTIONS.length}, (_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    _picks = [idx[0], idx[1]];
  }

  // ── CAPTCHA (QUIZ) BUILDER ──────────────────────────────────────────────────
  function buildCaptcha(containerId, questionIdx, onSuccess, excludeIdx) {
    const container = document.getElementById(containerId);
    let failCount = 0;
    let currentIdx = questionIdx;
    let q;

    function loadQuestion(idx) {
      currentIdx = idx;
      const qOrig = QUESTIONS[idx];
      const shuffled = [...qOrig.options].map((o, i) => ({...o, _origIdx: i}));
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      q = { ...qOrig, options: shuffled };
    }
    loadQuestion(questionIdx);

    // Swap in a fresh, distinct question — bureaucracy generously lets you
    // file for a different challenge instead of studying for this one.
    function reroll() {
      const candidates = QUESTIONS
        .map((_, i) => i)
        .filter(i => i !== currentIdx && i !== excludeIdx);
      loadQuestion(candidates[Math.floor(Math.random() * candidates.length)]);
      failCount = 0;
      render();
    }

    function render() {
      container.innerHTML = '';
      const panel = document.createElement('div');
      panel.className = 'captcha-panel';
      panel.innerHTML = `
        <h2>🤖 Identity Verification</h2>
        <p class="sub" style="font-size:0.62rem;color:#c8d6f8;line-height:1.9;">${q.prompt}</p>
        <div class="captcha-grid" id="${containerId}-grid"></div>
        <div id="${containerId}-feedback" style="width:100%;display:none;flex-direction:column;gap:6px;"></div>
        <p class="captcha-error" id="${containerId}-err"></p>
        <div style="display:flex;gap:10px;align-items:center;justify-content:center;width:100%;">
          <button id="${containerId}-btn">Verify</button>
          <button id="${containerId}-reroll" title="Request a different challenge" style="font-size:1.3rem;background:transparent;border:none;padding:4px 6px;cursor:pointer;line-height:1;">🎲</button>
        </div>
      `;
      container.appendChild(panel);
      show(containerId);
      document.getElementById(`${containerId}-reroll`).addEventListener('click', reroll);

      const grid = document.getElementById(`${containerId}-grid`);
      q.options.forEach((opt, i) => {
        const tile = document.createElement('div');
        tile.className = 'captcha-tile';
        tile.dataset.idx = String(i);
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
        const errEl    = document.getElementById(`${containerId}-err`);
        const btn      = document.getElementById(`${containerId}-btn`);
        const rerollBtn = document.getElementById(`${containerId}-reroll`);
        btn.disabled = true;
        rerollBtn.disabled = true;
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
            rerollBtn.disabled = false;
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
    'Evaluating policy: AmazonLeastPrivilegeBirdReadOnly... DENY',
    'Evaluating policy: AmazonLeastPrivilegeBirdPlayer... ALLOW',
    'Evaluating policy: AmazonLeastPrivilegeBirdHighScoreWrite... ALLOW',
    'Evaluating policy: AmazonLeastPrivilegeBirdAuditLog... ALLOW',
    'SCP: ou-prod-games → no explicit deny',
    'Permission boundary: LeastPrivilegeBirdPlayer-Prod → within bounds',
    'Session policy: inline → 3 statements evaluated',
    'Effective permissions: game:flap:write ✓',
    'Effective permissions: score:submit:put ✓',
    'Generating STS session token... done',
    'Token ARN: arn:aws:sts::139478927430:assumed-role/LeastPrivilegeBirdPlayer-Prod/session',
    'Registrando trámite en el expediente Nº ES-2026-FLAP-0042/IAM... hecho',
    'Justificante de autorización disponible en la carpeta ciudadana ✓',
  ];

  const SUBMIT_LINES = [
    'Assuming role LeastPrivilegeBirdPlayer-Prod... done',
    'PUT s3://least-privilege-bird-audit-logs-prod/scores/{user}.json',
    'Requesting KMS data key (mrk-lpb)... 200 OK',
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
  // The challenge is pure theater — input is never validated (always fail-then-
  // succeed). Rotate the prompt + the zero-trust "this is normal" excuse so the
  // step isn't identical every login.
  const MFA_CHALLENGES = [
    'Please enter the first 10 digits of π.',
    'Please enter your grandmother\'s maiden ARN.',
    'Please re-type the CAPTCHA you solved 4 seconds ago, from memory.',
    'Please enter the 12-digit account ID you were never given.',
    'Please provide the SHA-256 of your own determination.',
    'Please enter the current epoch timestamp. Be quick.',
    'Please type your security questions\' answers, in reverse.',
    'Please enter the last 4 digits of a credit card we did not specify.',
    'Please transcribe the contents of your clipboard. We trust you.',
    'Please enter the airspeed velocity of an unladen S3 bucket.',
  ];
  const MFA_EXCUSES = [
    'ℹ️ Esto es normal. Cl@ve realiza una doble verificación de confianza cero (zero-trust). Vuelva a introducir el código.',
    'ℹ️ Expected behaviour. The first attempt warms the HSM. Please try once more.',
    'ℹ️ This is fine. Our zero-trust model distrusts even correct answers once. Retry.',
    'ℹ️ Normal. The token was valid but arrived during a leap second. Re-enter it.',
    'ℹ️ As designed. Compliance requires that you fail at least once. You\'re doing great.',
  ];
  function _pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  function showMFA() {
    showClaveStep('clave-step-mfa');
    // Fresh challenge + excuse each time (display only — never validated).
    const promptEl = document.getElementById('mfa-prompt');
    if (promptEl) {
      promptEl.innerHTML = _pick(MFA_CHALLENGES);
    }
    const excuse = _pick(MFA_EXCUSES);
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

    return new Promise<void>(resolve => {
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
          hint.textContent  = excuse;
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
    _rollPicks();   // fresh question pair every login
    show('clave-screen');

    // Step 1 — CAPTCHA pre-login
    if (!window.DEV_MODE) {
      showClaveStep('clave-step-captcha-pre');
      await new Promise(resolve => buildCaptcha('clave-step-captcha-pre', _picks[0], resolve, _picks[1]));
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
      await new Promise(resolve => buildCaptcha('captcha-post-screen', _picks[1], resolve, _picks[0]));
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
