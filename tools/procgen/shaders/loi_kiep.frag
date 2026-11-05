// ============================================================================
//  LÔI KIẾP GIÁNG LÂM – Procedural Lightning (GLSL ES 1.0 / WebGL1, chạy cả WebGL2)
// ----------------------------------------------------------------------------
//  Không dùng texture, không dùng frame-by-frame. Mọi thứ tính từ toán:
//    • Tia chính: đoạn thẳng từ mây kiếp xuống điểm đánh, lệch ngang bằng fBm theo
//      tham số dọc tia t. Biên độ lệch nhân sin(πt) nên tia luôn nối đúng hai đầu.
//    • 3 nhánh phụ tách từ tia chính, cùng thuật toán, mờ dần về cuối nhánh.
//    • Nhấp nháy: đổi seed hình dạng mỗi 60 ms trong 0,3 s sống của tia.
//    • Va chạm mặt đất ISOMETRIC: vòng sóng và lõi sáng là ellipse 2:1, sau đó
//      vết cháy xém + than hồng tắt dần trong 2,5 s.
//    • Mây kiếp xoáy: fBm trên tọa độ cực có độ xoắn tăng theo bán kính.
//
//  Vẽ: một quad phủ màn hình (shaders/fullscreen.vert), blend ONE, ONE_MINUS_SRC_ALPHA
//  (đầu ra là premultiplied alpha; rgb được phép > a để có ánh sáng cộng).
//  Hệ tọa độ: pixel logic, gốc DƯỚI-TRÁI (như gl_FragCoord), trời ở phía y lớn.
//  Mobile: render vào render texture 1/2 độ phân giải rồi phóng lên là đủ đẹp.
// ============================================================================
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2  u_resolution;    // kích thước khung logic (px), ví dụ 1280 × 720
uniform float u_time;          // giây
uniform vec4  u_strikes[3];    // xy = điểm đánh trên mặt đất (px), z = thời điểm bắt đầu (s), w = seed
uniform float u_strikeCount;   // số tia đang dùng: 0..3
uniform vec2  u_cloudCenter;   // tâm xoáy mây kiếp (px)
uniform float u_skyHeight;     // điểm phát tia cao hơn điểm đánh bao nhiêu px (ví dụ 520)
uniform float u_intensity;     // 0..2 theo cấp kiếp (3 đạo → 0,6; 81 đạo → 2,0)
uniform vec3  u_boltColor;     // màu lôi, ví dụ vec3(0.72, 0.62, 1.0)
uniform float u_flashScale;    // 0 = tắt chớp màn hình (tùy chọn nhạy sáng), 1 = mặc định

varying vec2 v_uv;             // 0..1 trên toàn màn hình

const float PI = 3.14159265;
const float BOLT_LIFE = 0.34;  // tia sáng trong 0,34 s
const float AFTER_LIFE = 2.5;  // vết cháy còn 2,5 s

// ---------------------------------------------------------------------------
// Noise
// ---------------------------------------------------------------------------
float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Fractal Brownian Motion: 5 tầng, mỗi tầng gấp đôi tần số, nửa biên độ. Kết quả ~[0, 1].
float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    s += a * vnoise(p);
    p = p * 2.03 + vec2(17.1, 9.2);
    a *= 0.5;
  }
  return s / 0.96875;
}

// ---------------------------------------------------------------------------
// Tia sét
// ---------------------------------------------------------------------------
// Độ lệch ngang của tia tại vị trí t (0..1), đơn vị px.
float boltOffset(float t, float seed, float amp, float freq) {
  float env = pow(max(sin(PI * t), 0.0), 0.7);                 // = 0 ở hai đầu
  float big = (fbm(vec2(t * freq, seed)) - 0.5) * 2.0;         // khúc gãy lớn
  float jag = (vnoise(vec2(t * freq * 7.0, seed * 3.1)) - 0.5); // răng cưa nhỏ
  return (big + jag * 0.36) * amp * env;
}

// Khoảng cách (px) từ p tới tia đi từ A tới B. Trả về vec2(khoảng cách, t).
vec2 boltDist(vec2 p, vec2 A, vec2 B, float seed, float amp, float freq) {
  vec2 ab = B - A;
  float len = length(ab);
  vec2 dir = ab / len;
  vec2 nrm = vec2(-dir.y, dir.x);
  vec2 ap = p - A;
  float along = dot(ap, dir);
  float t = clamp(along / len, 0.0, 1.0);
  float across = dot(ap, nrm) - boltOffset(t, seed, amp, freq);
  float beyond = max(0.0, -along) + max(0.0, along - len);     // ra ngoài hai đầu đoạn
  return vec2(length(vec2(across, beyond)), t);
}

// Lõi Gauss sắc + quầng tắt dần kiểu 1/d (bloom giả, không cần render texture).
float boltGlow(float d, float coreW, float glowW) {
  float core = exp(-(d * d) / (coreW * coreW));
  float glow = glowW / (d + glowW);
  return core + glow * glow * 0.6;
}

// Đóng góp của một lần sét đánh. flash = mức chớp (0..1) để chiếu sáng mây và màn hình.
vec4 strike(vec2 p, vec4 s, out float flash) {
  flash = 0.0;
  float life = u_time - s.z;
  if (life < 0.0 || life > AFTER_LIFE) return vec4(0.0);

  float seed = s.w;
  vec2 B = s.xy;
  vec2 A = B + vec2((hash11(seed) - 0.5) * 160.0, u_skyHeight);
  float len = length(B - A);
  vec3 col = vec3(0.0);
  float alpha = 0.0;

  // --- Thân tia (chỉ trong 0,34 s đầu) ---
  float env = smoothstep(0.0, 0.015, life) * (1.0 - smoothstep(0.18, BOLT_LIFE, life));
  float stepId = floor(life / 0.06);                 // đổi hình mỗi 60 ms
  float rs = seed + stepId * 7.13;
  env *= 0.72 + 0.28 * step(0.35, hash11(rs));       // chớp tắt không đều

  // Bỏ qua phép tính nặng khi pixel nằm xa vùng tia
  bool nearBolt = p.x > min(A.x, B.x) - 220.0 && p.x < max(A.x, B.x) + 220.0 &&
                  p.y > B.y - 40.0 && p.y < A.y + 40.0;

  if (env > 0.0 && nearBolt) {
    float amp = len * 0.09;
    vec2 m = boltDist(p, A, B, rs, amp, 5.0);
    float w = mix(2.8, 1.7, m.y) * (0.8 + 0.25 * u_intensity);
    float g = boltGlow(m.x, w, 14.0 * (0.7 + 0.3 * u_intensity));

    vec2 dir = (B - A) / len;
    vec2 nrm = vec2(-dir.y, dir.x);
    for (int k = 0; k < 3; k++) {
      float fk = float(k);
      float tb = 0.16 + 0.22 * fk + 0.08 * hash11(rs + fk);           // điểm tách nhánh
      vec2 P0 = A + (B - A) * tb + nrm * boltOffset(tb, rs, amp, 5.0);
      float side = hash11(rs + fk * 3.7) < 0.5 ? -1.0 : 1.0;
      float ang = side * (0.35 + 0.35 * hash11(rs + fk * 5.3));
      vec2 bd = vec2(dir.x * cos(ang) - dir.y * sin(ang), dir.x * sin(ang) + dir.y * cos(ang));
      vec2 P1 = P0 + bd * len * (0.18 + 0.20 * hash11(rs + fk * 9.1));
      vec2 mb = boltDist(p, P0, P1, rs + 11.0 + fk, len * 0.045, 6.0);
      g += boltGlow(mb.x, 1.2, 7.0) * (1.0 - mb.y) * 0.7;
    }
    vec3 c = mix(u_boltColor, vec3(1.0), clamp(g - 0.6, 0.0, 1.0));  // lõi trắng, quầng tím
    col += c * g * env * (0.8 + 0.2 * u_intensity);
    alpha = max(alpha, clamp(g * env, 0.0, 1.0));
  }

  // --- Va chạm mặt đất isometric: nén trục Y còn 1/2 → đo bằng (dx, 2·dy) ---
  vec2 q = (p - B) * vec2(1.0, 2.0);
  float dq = length(q);
  float ringR = 18.0 + 260.0 * life;
  float ring = exp(-pow((dq - ringR) / 10.0, 2.0)) * (1.0 - smoothstep(0.0, 0.45, life));
  float core = exp(-(dq * dq) / (36.0 * 36.0)) * (1.0 - smoothstep(0.05, 0.6, life)) * 1.6;
  col += u_boltColor * ring * 0.9 + vec3(1.0, 0.95, 1.0) * core;
  alpha = max(alpha, clamp(ring * 0.9 + core, 0.0, 1.0));

  // --- Vết cháy xém (làm tối bằng alpha) + than hồng ---
  float edgeNoise = (vnoise(q * 0.08 + seed) - 0.5) * 20.0;
  float scorchMask = 1.0 - smoothstep(30.0, 52.0, dq + edgeNoise);
  float ember = scorchMask * smoothstep(0.62, 0.9, vnoise(q * 0.15 + seed * 2.0)) *
                (1.0 - smoothstep(0.3, AFTER_LIFE, life));
  col += vec3(1.0, 0.45, 0.15) * ember * 0.8;
  float scorch = scorchMask * smoothstep(0.02, 0.1, life) * (1.0 - smoothstep(1.2, AFTER_LIFE, life));
  alpha = max(alpha, scorch * 0.55);

  flash = env;
  return vec4(col, alpha);
}

// ---------------------------------------------------------------------------
// Mây kiếp xoáy
// ---------------------------------------------------------------------------
vec4 tribulationCloud(vec2 p, float flash) {
  vec2 d = (p - u_cloudCenter) * vec2(1.0, 2.2);   // dẹt theo phối cảnh nhìn chéo
  float r = length(d);
  float ang = atan(d.y, d.x) + r * 0.006 - u_time * 0.25;   // xoắn tăng theo bán kính, quay chậm
  vec2 sp = vec2(cos(ang), sin(ang)) * r * 0.008;
  float n = fbm(sp * 3.0 + vec2(0.0, u_time * 0.05));
  float mask = 1.0 - smoothstep(260.0, 520.0, r);
  float dens = smoothstep(0.35, 0.75, n) * mask;
  float eye = smoothstep(30.0, 90.0, r);            // mắt bão ở tâm trống hơn
  vec3 dark = vec3(0.10, 0.07, 0.16);
  vec3 lit = mix(u_boltColor, vec3(1.0), 0.3);
  vec3 c = mix(dark, lit, clamp(flash * (0.4 + 0.6 * n) * eye, 0.0, 1.0));
  float a = dens * 0.85;
  return vec4(c * a, a);
}

// ---------------------------------------------------------------------------
void main() {
  vec2 p = v_uv * u_resolution;

  vec4 bolts = vec4(0.0);
  float flash = 0.0;
  for (int i = 0; i < 3; i++) {
    if (float(i) >= u_strikeCount) break;
    float f;
    vec4 s = strike(p, u_strikes[i], f);
    bolts.rgb += s.rgb;                // ánh sáng cộng dồn
    bolts.a = max(bolts.a, s.a);
    flash = max(flash, f);
  }

  vec4 cloud = tribulationCloud(p, flash);

  // Tia nằm trước mây (premultiplied "over")
  vec4 outc;
  outc.rgb = bolts.rgb + cloud.rgb * (1.0 - bolts.a);
  outc.a = bolts.a + cloud.a * (1.0 - bolts.a);

  // Chớp toàn màn hình, mạnh hơn ở phía trời
  float sky = smoothstep(0.2, 1.0, v_uv.y);
  float fl = flash * 0.22 * u_flashScale * (0.5 + 0.5 * sky);
  outc.rgb += vec3(0.85, 0.82, 1.0) * fl;
  outc.a = max(outc.a, fl);

  gl_FragColor = outc;
}
