(() => {
  // ─── Constants ────────────────────────────────────────────────────────────
  const CANVAS_WIDTH  = 800;
  const CANVAS_HEIGHT = 400;
  const GROUND_Y      = 320;   // top of grass strip
  const JAKE_SCREEN_X = 120;
  const LEVEL_LENGTH  = 8000;
  const STORE_WORLD_X = 7500;
  const GRAVITY       = 1600;  // px/s²
  const JUMP_FORCE    = -750;  // px/s (upward)
  const SPEED_INITIAL = 220;
  const SPEED_MAX     = 380;

  const OBSTACLE_DEFS = {
    rock:      { width: 30, height: 28 },
    small_box: { width: 32, height: 32 },
    barrel:    { width: 30, height: 40 },
    tall_box:  { width: 36, height: 52 },
    boulder:   { width: 48, height: 38 },
  };

  // ─── Canvas / Context ─────────────────────────────────────────────────────
  const canvas = document.getElementById('gameCanvas');
  const ctx    = canvas.getContext('2d');

  // ─── Overlay elements ────────────────────────────────────────────────────
  const startScreen    = document.getElementById('start-screen');
  const winScreen      = document.getElementById('win-screen');
  const gameoverScreen = document.getElementById('gameover-screen');
  const winDistEl      = document.getElementById('win-distance');
  const winTimeEl      = document.getElementById('win-time');
  const goDistEl       = document.getElementById('gameover-distance');

  // ─── State ────────────────────────────────────────────────────────────────
  let gameState;  // 'start' | 'playing' | 'dead' | 'win'
  let camera;
  let jake;
  let obstacles;
  let clouds;
  let hills;
  let gameSpeed;
  let lastTime;
  let startTime;
  let deathTimer;
  let deathRotation;
  let winBounceTime;
  let rafId;
  let deathTimeoutId;

  function rng(min, max) { return min + Math.random() * (max - min); }
  function rngInt(min, max) { return Math.floor(rng(min, max + 1)); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // ─── Level Generation ─────────────────────────────────────────────────────
  function generateLevel() {
    obstacles = [];
    clouds    = [];
    hills     = [];

    // Clouds — extend to ~3.5× level length to cover parallax at 0.3×
    for (let wx = 0; wx < LEVEL_LENGTH * 3.5; wx += rng(220, 520)) {
      clouds.push({
        worldX: wx,
        y:      rng(30, 150),
        width:  rng(80, 180),
        puff:   rng(0.7, 1.3),
      });
    }

    // Distant hills — at 0.5× parallax, range 0..LEVEL_LENGTH*2
    for (let wx = 0; wx < LEVEL_LENGTH * 2; wx += rng(300, 700)) {
      hills.push({
        worldX: wx,
        y:      GROUND_Y - rng(40, 100),
        width:  rng(160, 320),
        color:  `hsl(${rngInt(90,140)}, ${rngInt(35,55)}%, ${rngInt(45,65)}%)`,
      });
    }

    // Obstacles — procedurally generated
    let cursor = 700;  // safe zone
    while (cursor < STORE_WORLD_X - 300) {
      const progress = cursor / STORE_WORLD_X;
      let minGap, maxGap;
      let types;
      if (progress < 0.25) {
        minGap = 480; maxGap = 650; types = ['rock','small_box'];
      } else if (progress < 0.5) {
        minGap = 400; maxGap = 560; types = ['rock','small_box','barrel'];
      } else if (progress < 0.75) {
        minGap = 340; maxGap = 480; types = ['rock','barrel','tall_box','boulder'];
      } else {
        minGap = 300; maxGap = 420; types = ['small_box','barrel','tall_box','boulder'];
      }

      cursor += rng(minGap, maxGap);
      const type = types[rngInt(0, types.length - 1)];
      const def  = OBSTACLE_DEFS[type];
      obstacles.push({ worldX: cursor, type, width: def.width, height: def.height });
      cursor += def.width;

      // Occasional back-to-back pair only near the very end
      if (progress > 0.85 && Math.random() < 0.15) {
        cursor += rng(200, 280);
        const type2 = types[rngInt(0, types.length - 1)];
        const def2  = OBSTACLE_DEFS[type2];
        obstacles.push({ worldX: cursor, type: type2, width: def2.width, height: def2.height });
        cursor += def2.width;
      }
    }
  }

  // ─── Init ─────────────────────────────────────────────────────────────────
  function initGame() {
    camera       = { x: 0 };
    gameSpeed    = SPEED_INITIAL;
    startTime    = null;
    deathTimer   = 0;
    deathRotation = 0;
    winBounceTime = 0;

    jake = {
      worldX:    camera.x + JAKE_SCREEN_X,
      screenX:   JAKE_SCREEN_X,
      y:         GROUND_Y - 48,
      width:     28,
      height:    48,
      vy:        0,
      isGrounded: true,
      animFrame: 0,
      animTimer: 0,
      isDead:    false,
    };

    generateLevel();
  }

  // ─── Draw: Jake ───────────────────────────────────────────────────────────
  function drawJake(x, y, animFrame, isJumping, isDead, rotation) {
    ctx.save();
    if (isDead) {
      ctx.translate(x + 14, y + 48);
      ctx.rotate(rotation);
      ctx.translate(-(x + 14), -(y + 48));
    }

    const skin  = '#F4A460';
    const hair  = '#8B4513';
    const shirt = '#FF4500';
    const jeans = '#4169E1';
    const shoe  = '#FFFFFF';
    const sole  = '#BBBBBB';

    if (isJumping) {
      // Jump pose: legs tucked, arms raised
      // Shoes
      ctx.fillStyle = sole;
      ctx.fillRect(x + 4, y + 40, 10, 5);
      ctx.fillRect(x + 15, y + 38, 10, 5);
      ctx.fillStyle = shoe;
      ctx.fillRect(x + 4, y + 34, 10, 7);
      ctx.fillRect(x + 15, y + 32, 10, 7);

      // Legs (tucked)
      ctx.fillStyle = jeans;
      ctx.fillRect(x + 5, y + 28, 9, 10);
      ctx.fillRect(x + 15, y + 26, 9, 10);

      // Torso
      ctx.fillStyle = shirt;
      ctx.fillRect(x + 4, y + 15, 20, 16);

      // Arms raised
      ctx.fillStyle = skin;
      ctx.fillRect(x - 2, y + 10, 7, 12);
      ctx.fillRect(x + 23, y + 10, 7, 12);

      // Neck
      ctx.fillStyle = skin;
      ctx.fillRect(x + 10, y + 10, 8, 6);

      // Head
      ctx.fillStyle = skin;
      ctx.beginPath();
      ctx.roundRect(x + 5, y + 0, 18, 16, 4);
      ctx.fill();

      // Hair
      ctx.fillStyle = hair;
      ctx.fillRect(x + 4, y + 0, 20, 7);
      ctx.beginPath();
      ctx.arc(x + 14, y + 0, 9, Math.PI, 0);
      ctx.fill();

      // Eyes
      ctx.fillStyle = '#fff';
      ctx.fillRect(x + 7, y + 5, 5, 4);
      ctx.fillRect(x + 16, y + 5, 5, 4);
      ctx.fillStyle = '#222';
      ctx.fillRect(x + 9, y + 6, 2, 3);
      ctx.fillRect(x + 18, y + 6, 2, 3);

    } else {
      // Run cycle
      const legSwing = animFrame === 0 ? 1 : -1;

      // Shoes
      ctx.fillStyle = sole;
      ctx.fillRect(x + 3 + legSwing * 3,  y + 43, 11, 5);
      ctx.fillRect(x + 15 - legSwing * 3, y + 43, 11, 5);
      ctx.fillStyle = shoe;
      ctx.fillRect(x + 3 + legSwing * 3,  y + 37, 10, 7);
      ctx.fillRect(x + 15 - legSwing * 3, y + 37, 10, 7);

      // Legs
      ctx.fillStyle = jeans;
      ctx.fillRect(x + 4 + legSwing * 3,  y + 26, 9, 16);
      ctx.fillRect(x + 15 - legSwing * 3, y + 26, 9, 16);

      // Torso
      ctx.fillStyle = shirt;
      ctx.fillRect(x + 3, y + 14, 22, 14);

      // Arms swing
      ctx.fillStyle = skin;
      ctx.fillRect(x - 3 + legSwing * 3,  y + 16, 7, 12);
      ctx.fillRect(x + 24 - legSwing * 3, y + 16, 7, 12);

      // Neck
      ctx.fillStyle = skin;
      ctx.fillRect(x + 10, y + 9, 8, 6);

      // Head
      ctx.fillStyle = skin;
      ctx.beginPath();
      ctx.roundRect(x + 5, y + 0, 18, 16, 4);
      ctx.fill();

      // Hair
      ctx.fillStyle = hair;
      ctx.fillRect(x + 4, y - 1, 20, 8);
      ctx.beginPath();
      ctx.arc(x + 14, y, 9, Math.PI, 0);
      ctx.fill();

      // Eyes
      ctx.fillStyle = '#fff';
      ctx.fillRect(x + 7, y + 4, 5, 4);
      ctx.fillRect(x + 16, y + 4, 5, 4);
      ctx.fillStyle = '#222';
      ctx.fillRect(x + 9, y + 5, 2, 3);
      ctx.fillRect(x + 18, y + 5, 2, 3);

      // Smile
      ctx.strokeStyle = '#8B4513';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x + 14, y + 11, 4, 0.2, Math.PI - 0.2);
      ctx.stroke();
    }

    ctx.restore();
  }

  // ─── Draw: Rock ───────────────────────────────────────────────────────────
  function drawRock(sx, sy, w, h) {
    ctx.fillStyle = '#888888';
    ctx.beginPath();
    ctx.moveTo(sx + w * 0.5, sy);
    ctx.lineTo(sx + w * 0.8, sy + h * 0.15);
    ctx.lineTo(sx + w,       sy + h * 0.55);
    ctx.lineTo(sx + w * 0.9, sy + h);
    ctx.lineTo(sx + w * 0.1, sy + h);
    ctx.lineTo(sx,           sy + h * 0.6);
    ctx.lineTo(sx + w * 0.15, sy + h * 0.2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#AAAAAA';
    ctx.beginPath();
    ctx.moveTo(sx + w * 0.5, sy + 3);
    ctx.lineTo(sx + w * 0.72, sy + h * 0.18);
    ctx.lineTo(sx + w * 0.55, sy + h * 0.4);
    ctx.lineTo(sx + w * 0.3,  sy + h * 0.25);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#666';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function drawBoulder(sx, sy, w, h) {
    ctx.fillStyle = '#7A7A7A';
    ctx.beginPath();
    ctx.moveTo(sx + w * 0.45, sy);
    ctx.lineTo(sx + w * 0.75, sy + h * 0.1);
    ctx.lineTo(sx + w,        sy + h * 0.45);
    ctx.lineTo(sx + w * 0.88, sy + h);
    ctx.lineTo(sx + w * 0.12, sy + h);
    ctx.lineTo(sx,            sy + h * 0.5);
    ctx.lineTo(sx + w * 0.18, sy + h * 0.12);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#9E9E9E';
    ctx.beginPath();
    ctx.moveTo(sx + w * 0.45, sy + 3);
    ctx.lineTo(sx + w * 0.7,  sy + h * 0.2);
    ctx.lineTo(sx + w * 0.5,  sy + h * 0.45);
    ctx.lineTo(sx + w * 0.25, sy + h * 0.28);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  function drawBox(sx, sy, w, h) {
    ctx.fillStyle = '#DEB887';
    ctx.fillRect(sx, sy, w, h);
    ctx.strokeStyle = '#8B6914';
    ctx.lineWidth = 2;
    ctx.strokeRect(sx + 3, sy + 3, w - 6, h - 6);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(sx + 3, sy + 3); ctx.lineTo(sx + w - 3, sy + h - 3);
    ctx.moveTo(sx + w - 3, sy + 3); ctx.lineTo(sx + 3, sy + h - 3);
    ctx.stroke();
    ctx.strokeStyle = '#C8A060';
    ctx.lineWidth = 2;
    ctx.strokeRect(sx, sy, w, h);
  }

  function drawBarrel(sx, sy, w, h) {
    // Body
    ctx.fillStyle = '#8B4513';
    ctx.beginPath();
    ctx.roundRect(sx + 2, sy, w - 4, h, 6);
    ctx.fill();
    // Metal bands
    ctx.strokeStyle = '#654321';
    ctx.lineWidth = 3;
    [0.15, 0.5, 0.85].forEach(t => {
      ctx.beginPath();
      ctx.moveTo(sx + 2, sy + h * t);
      ctx.lineTo(sx + w - 2, sy + h * t);
      ctx.stroke();
    });
    // Top ellipse
    ctx.fillStyle = '#A0522D';
    ctx.beginPath();
    ctx.ellipse(sx + w / 2, sy + 4, w / 2 - 2, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#654321';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // Outline
    ctx.strokeStyle = '#5A2D0C';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(sx + 2, sy, w - 4, h, 6);
    ctx.stroke();
  }

  // ─── Draw: Obstacle dispatcher ────────────────────────────────────────────
  function drawObstacle(obs, screenX) {
    const sy = GROUND_Y - obs.height;
    switch (obs.type) {
      case 'rock':      drawRock(screenX, sy, obs.width, obs.height); break;
      case 'boulder':   drawBoulder(screenX, sy, obs.width, obs.height); break;
      case 'small_box': drawBox(screenX, sy, obs.width, obs.height); break;
      case 'tall_box':  drawBox(screenX, sy, obs.width, obs.height); break;
      case 'barrel':    drawBarrel(screenX, sy, obs.width, obs.height); break;
    }
  }

  // ─── Draw: Cloud ──────────────────────────────────────────────────────────
  function drawCloud(x, y, w, puff) {
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    [[0.25, 0, 0.32, 18], [0.5, -10, 0.38, 24], [0.75, -2, 0.28, 16]].forEach(([fx, oy, fw, fh]) => {
      ctx.beginPath();
      ctx.ellipse(x + w * fx, y + oy * puff, w * fw, fh * puff, 0, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  // ─── Draw: Hills ──────────────────────────────────────────────────────────
  function drawHill(sx, y, w, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(sx, GROUND_Y);
    ctx.quadraticCurveTo(sx + w / 2, y, sx + w, GROUND_Y);
    ctx.closePath();
    ctx.fill();
  }

  // ─── Draw: Pizza Store ────────────────────────────────────────────────────
  function drawPizzaStore(screenX) {
    const bx = screenX;
    const bw = 220;
    const bh = 195;
    const by = GROUND_Y - bh;

    // Main building
    ctx.fillStyle = '#CC2200';
    ctx.fillRect(bx, by, bw, bh);

    // Side wall shading
    ctx.fillStyle = '#AA1800';
    ctx.fillRect(bx + bw - 20, by, 20, bh);

    // Roof base
    ctx.fillStyle = '#AA1800';
    ctx.fillRect(bx - 8, by - 18, bw + 16, 22);

    // Roof trim (yellow)
    ctx.fillStyle = '#FFD700';
    ctx.fillRect(bx - 8, by - 18, bw + 16, 6);

    // Awning stripes (alternating red/yellow)
    const awningY  = by + 55;
    const awningH  = 28;
    ctx.save();
    ctx.beginPath();
    ctx.rect(bx, awningY, bw, awningH + 8);
    ctx.clip();
    for (let i = 0; i < bw; i += 20) {
      ctx.fillStyle = i % 40 === 0 ? '#FFD700' : '#CC2200';
      ctx.fillRect(bx + i, awningY, 20, awningH);
    }
    // Awning scalloped bottom
    ctx.fillStyle = '#FFD700';
    for (let i = 0; i < bw; i += 18) {
      ctx.beginPath();
      ctx.arc(bx + i + 9, awningY + awningH, 10, 0, Math.PI);
      ctx.fill();
    }
    ctx.restore();
    // Awning top border
    ctx.fillStyle = '#AA1800';
    ctx.fillRect(bx, awningY - 4, bw, 6);

    // Sign background
    const signX = bx + 15;
    const signY = by + 8;
    const signW = bw - 30;
    const signH = 44;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(signX, signY, signW, signH);
    ctx.strokeStyle = '#FFD700';
    ctx.lineWidth = 3;
    ctx.strokeRect(signX, signY, signW, signH);

    // Sign text
    ctx.fillStyle = '#CC2200';
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Little Caesars', bx + bw / 2, signY + 18);
    ctx.fillStyle = '#FFD700';
    ctx.font = 'bold 13px Arial';
    ctx.fillText('PIZZA!', bx + bw / 2, signY + 35);
    ctx.textAlign = 'left';

    // Caesar figure (left side of sign area)
    drawCaesarFigure(bx + 15, by + 56);

    // Windows
    [[bx + 20, by + 90], [bx + bw - 62, by + 90]].forEach(([wx, wy]) => {
      ctx.fillStyle = '#ADE8F4';
      ctx.fillRect(wx, wy, 42, 40);
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 3;
      ctx.strokeRect(wx, wy, 42, 40);
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(wx + 21, wy); ctx.lineTo(wx + 21, wy + 40);
      ctx.moveTo(wx, wy + 20); ctx.lineTo(wx + 42, wy + 20);
      ctx.stroke();
    });

    // Door
    const dx = bx + bw / 2 - 22;
    const dy = by + bh - 70;
    const dw = 44;
    const dh = 70;
    ctx.fillStyle = '#8B4513';
    ctx.beginPath();
    ctx.moveTo(dx, dy + dh);
    ctx.lineTo(dx, dy + 12);
    ctx.arc(dx + dw / 2, dy + 12, dw / 2, Math.PI, 0);
    ctx.lineTo(dx + dw, dy + dh);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#5A2D0C';
    ctx.lineWidth = 2;
    ctx.stroke();
    // Door handle
    ctx.fillStyle = '#FFD700';
    ctx.beginPath();
    ctx.arc(dx + dw - 10, dy + dh / 2 + 8, 4, 0, Math.PI * 2);
    ctx.fill();

    // Rooftop flag/banner
    for (let i = 0; i < bw; i += 24) {
      ctx.fillStyle = i % 48 === 0 ? '#FFD700' : '#CC2200';
      ctx.beginPath();
      ctx.moveTo(bx + i, by - 18);
      ctx.lineTo(bx + i + 12, by - 30);
      ctx.lineTo(bx + i + 24, by - 18);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawCaesarFigure(x, y) {
    // Toga body (white triangle shape)
    ctx.fillStyle = '#EEEEEE';
    ctx.beginPath();
    ctx.moveTo(x + 10, y + 10);
    ctx.lineTo(x + 0,  y + 38);
    ctx.lineTo(x + 22, y + 38);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#CCCCCC';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Head
    ctx.fillStyle = '#F4C28B';
    ctx.beginPath();
    ctx.arc(x + 11, y + 7, 8, 0, Math.PI * 2);
    ctx.fill();

    // Laurel wreath
    ctx.strokeStyle = '#228B22';
    ctx.lineWidth = 2;
    for (let i = -3; i <= 3; i++) {
      ctx.beginPath();
      ctx.arc(x + 11 + i * 3, y + 2, 4, Math.PI * 0.8, Math.PI * 2.2);
      ctx.stroke();
    }

    // Eyes
    ctx.fillStyle = '#333';
    ctx.fillRect(x + 7, y + 6, 2, 2);
    ctx.fillRect(x + 13, y + 6, 2, 2);

    // Pizza slice (held up)
    ctx.fillStyle = '#FFD700';
    ctx.beginPath();
    ctx.moveTo(x + 22, y + 14);
    ctx.lineTo(x + 18, y + 26);
    ctx.lineTo(x + 28, y + 26);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#CC2200';
    ctx.lineWidth = 1;
    ctx.stroke();
    // Pepperoni
    ctx.fillStyle = '#CC2200';
    ctx.beginPath();
    ctx.arc(x + 23, y + 22, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // ─── Draw: Background ─────────────────────────────────────────────────────
  function drawBackground() {
    // Sky gradient
    const skyGrad = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
    skyGrad.addColorStop(0, '#87CEEB');
    skyGrad.addColorStop(1, '#D6F0FF');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, CANVAS_WIDTH, GROUND_Y);

    // Hills (parallax 0.5×)
    for (const h of hills) {
      const sx = h.worldX - camera.x * 0.5;
      if (sx > CANVAS_WIDTH + 400 || sx + h.width < -400) continue;
      drawHill(sx, h.y, h.width, h.color);
    }

    // Clouds (parallax 0.3×)
    for (const c of clouds) {
      const sx = c.worldX - camera.x * 0.3;
      if (sx > CANVAS_WIDTH + 250 || sx + c.width < -250) continue;
      drawCloud(sx, c.y, c.width, c.puff);
    }

    // Ground
    ctx.fillStyle = '#228B22';
    ctx.fillRect(0, GROUND_Y, CANVAS_WIDTH, 10);
    ctx.fillStyle = '#5A3A00';
    ctx.fillRect(0, GROUND_Y + 10, CANVAS_WIDTH, CANVAS_HEIGHT - GROUND_Y - 10);

    // Grass blades
    ctx.strokeStyle = '#1A6B1A';
    ctx.lineWidth = 1.5;
    const bladeSpacing = 14;
    const bladeOffset  = camera.x % bladeSpacing;
    for (let bx = -bladeOffset; bx < CANVAS_WIDTH; bx += bladeSpacing) {
      ctx.beginPath();
      ctx.moveTo(bx, GROUND_Y + 10);
      ctx.lineTo(bx - 3, GROUND_Y + 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(bx + 4, GROUND_Y + 10);
      ctx.lineTo(bx + 7, GROUND_Y + 2);
      ctx.stroke();
    }
  }

  // ─── Draw: HUD ────────────────────────────────────────────────────────────
  function drawHUD() {
    const metersToGo = Math.max(0, Math.floor((STORE_WORLD_X - jake.worldX) / 10));
    const pct = clamp(jake.worldX / STORE_WORLD_X, 0, 1);

    // Progress bar background
    const barX = CANVAS_WIDTH - 185;
    const barY = 10;
    const barW = 170;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.roundRect(barX - 5, barY - 5, barW + 10, 48, 6);
    ctx.fill();

    // Label
    ctx.fillStyle = '#FFD700';
    ctx.font = 'bold 13px Arial';
    ctx.textAlign = 'right';
    ctx.fillText(`🍕 ${metersToGo}m`, CANVAS_WIDTH - 10, barY + 14);
    ctx.textAlign = 'left';

    // Bar track
    ctx.fillStyle = '#333';
    ctx.fillRect(barX, barY + 20, barW, 12);

    // Bar fill
    const grad = ctx.createLinearGradient(barX, 0, barX + barW, 0);
    grad.addColorStop(0, '#FF4500');
    grad.addColorStop(1, '#FFD700');
    ctx.fillStyle = grad;
    ctx.fillRect(barX, barY + 20, barW * pct, 12);

    // Pizza icon at end
    ctx.font = '14px Arial';
    ctx.fillText('🍕', barX + barW - 2, barY + 32);
  }

  // ─── Collision Detection ──────────────────────────────────────────────────
  function checkCollisions() {
    const jx = jake.screenX + 9;
    const jy = jake.y + 6;
    const jw = jake.width - 18;
    const jh = jake.height - 14;

    for (const obs of obstacles) {
      const sx = obs.worldX - camera.x;
      if (sx > CANVAS_WIDTH || sx + obs.width < 0) continue;
      const ox = sx + 5;
      const oy = GROUND_Y - obs.height + 4;
      const ow = obs.width - 10;
      const oh = obs.height - 6;
      if (jx < ox + ow && jx + jw > ox && jy < oy + oh && jy + jh > oy) {
        triggerDeath();
        return;
      }
    }
  }

  // ─── Physics / Update ─────────────────────────────────────────────────────
  function update(dt) {
    const s = dt / 1000;

    // Speed ramp
    const progress = camera.x / STORE_WORLD_X;
    gameSpeed = SPEED_INITIAL + (SPEED_MAX - SPEED_INITIAL) * Math.pow(clamp(progress, 0, 1), 0.6);

    // Advance camera and Jake
    camera.x    += gameSpeed * s;
    jake.worldX  = camera.x + JAKE_SCREEN_X;

    // Gravity
    if (!jake.isGrounded) {
      jake.vy += GRAVITY * s;
      jake.y  += jake.vy * s;
    }

    // Ground collision
    if (jake.y >= GROUND_Y - jake.height) {
      jake.y        = GROUND_Y - jake.height;
      jake.vy       = 0;
      jake.isGrounded = true;
    }

    // Run animation
    jake.animTimer += dt;
    if (jake.animTimer > 130) {
      jake.animFrame = jake.animFrame ^ 1;
      jake.animTimer = 0;
    }

    checkCollisions();

    // Win check
    if (jake.worldX >= STORE_WORLD_X + 60) {
      triggerWin();
    }
  }

  // ─── Win / Death ──────────────────────────────────────────────────────────
  function triggerWin() {
    if (gameState === 'win') return;
    gameState    = 'win';
    winBounceTime = 0;
    const elapsed = startTime ? ((performance.now() - startTime) / 1000).toFixed(1) : 0;
    const dist    = Math.floor(jake.worldX / 10);
    winDistEl.textContent = `Distance: ${dist}m`;
    winTimeEl.textContent = `Time: ${elapsed}s`;
    winScreen.classList.remove('hidden');
  }

  function triggerDeath() {
    if (gameState === 'dead' || jake.isDead) return;
    jake.isDead  = true;
    gameState    = 'dead';
    deathTimer   = 0;
    deathRotation = 0;
    goDistEl.textContent = `Distance: ${Math.floor(jake.worldX / 10)}m`;
    deathTimeoutId = setTimeout(() => {
      gameoverScreen.classList.remove('hidden');
    }, 900);
  }

  // ─── Draw frame ───────────────────────────────────────────────────────────
  function draw() {
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    drawBackground();

    // Store
    const storeSX = STORE_WORLD_X - camera.x;
    if (storeSX < CANVAS_WIDTH + 50 && storeSX + 250 > -50) {
      drawPizzaStore(storeSX);
    }

    // Obstacles
    for (const obs of obstacles) {
      const sx = obs.worldX - camera.x;
      if (sx > CANVAS_WIDTH + 50 || sx + obs.width < -50) continue;
      drawObstacle(obs, sx);
    }

    // Jake
    const isJumping = !jake.isGrounded;
    if (gameState === 'win') {
      const bounce = Math.abs(Math.sin(winBounceTime * 6)) * 18;
      drawJake(jake.screenX, jake.y - bounce, jake.animFrame, true, false, 0);
    } else {
      drawJake(jake.screenX, jake.y, jake.animFrame, isJumping, jake.isDead, deathRotation);
    }

    // HUD (only while playing or dead)
    if (gameState === 'playing' || gameState === 'dead') {
      drawHUD();
    }
  }

  // ─── Game Loop ────────────────────────────────────────────────────────────
  function gameLoop(timestamp) {
    if (gameState !== 'playing' && gameState !== 'dead' && gameState !== 'win') return;

    if (startTime === null) startTime = timestamp;
    const dt = clamp(timestamp - (lastTime || timestamp), 0, 50);
    lastTime = timestamp;

    if (gameState === 'playing') {
      update(dt);
    } else if (gameState === 'dead') {
      deathTimer    += dt;
      deathRotation  = clamp((deathTimer / 650) * (Math.PI / 2), 0, Math.PI / 2);
    } else if (gameState === 'win') {
      winBounceTime += dt / 1000;
    }

    draw();
    rafId = requestAnimationFrame(gameLoop);
  }

  // ─── Start-screen static preview ─────────────────────────────────────────
  function drawStartPreview() {
    // Temporary camera/jake for preview
    const previewCam  = { x: 0 };
    const savedCamera = camera;
    const savedJake   = jake;

    camera = previewCam;
    jake   = { worldX: JAKE_SCREEN_X, screenX: JAKE_SCREEN_X, y: GROUND_Y - 48, animFrame: 0, isGrounded: true };

    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    drawBackground();

    // Draw store far right in preview
    const prevStoreSX = CANVAS_WIDTH - 150;
    drawPizzaStore(prevStoreSX);

    // Draw a couple sample obstacles
    drawObstacle({ type: 'barrel', width: 30, height: 40 }, 350);
    drawObstacle({ type: 'rock',   width: 30, height: 28 }, 480);
    drawObstacle({ type: 'small_box', width: 32, height: 32 }, 580);

    drawJake(jake.screenX, jake.y, 0, false, false, 0);

    camera = savedCamera;
    jake   = savedJake;
  }

  // ─── Input ────────────────────────────────────────────────────────────────
  function handleJump() {
    if (gameState === 'playing' && jake.isGrounded) {
      jake.vy        = JUMP_FORCE;
      jake.isGrounded = false;
    }
  }

  function setupInput() {
    document.addEventListener('keydown', e => {
      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault();
        handleJump();
      }
    });
    canvas.addEventListener('click', handleJump);
    canvas.addEventListener('touchstart', e => {
      e.preventDefault();
      handleJump();
    }, { passive: false });
  }

  // ─── Button wiring ────────────────────────────────────────────────────────
  function startGame() {
    // Hide all overlays
    startScreen.classList.add('hidden');
    winScreen.classList.add('hidden');
    gameoverScreen.classList.add('hidden');

    if (rafId) cancelAnimationFrame(rafId);
    if (deathTimeoutId) clearTimeout(deathTimeoutId);

    initGame();
    gameState = 'playing';
    lastTime  = null;
    startTime = null;
    rafId     = requestAnimationFrame(gameLoop);
  }

  document.getElementById('startBtn').addEventListener('click', startGame);
  document.getElementById('playAgainBtn').addEventListener('click', startGame);
  document.getElementById('tryAgainBtn').addEventListener('click', startGame);

  // ─── Bootstrap ────────────────────────────────────────────────────────────
  setupInput();
  initGame();
  gameState = 'start';
  drawStartPreview();
})();
