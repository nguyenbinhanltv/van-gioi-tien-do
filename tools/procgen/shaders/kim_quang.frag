// ============================================================================
//  KIM QUANG HỘ THỂ – Fresnel 2D + gợn sóng khi trúng đòn (GLSL ES 1.0 / WebGL1)
// ----------------------------------------------------------------------------
//  Vẽ trên một quad bao trọn khiên (lớn hơn sprite nhân vật). Gồm 4 lớp, đều tính bằng toán:
//    1. Sprite nhân vật lấy từ atlas (hoặc render texture đã repack của paperdoll).
//    2. Bong bóng khiên: coi ellipse là hình cầu, dựng pháp tuyến giả nz = sqrt(1 − d²)
//       -> Fresnel = (1 − nz)^p: tâm trong suốt, viền sáng vàng kim.
//    3. Lưới phù văn lục giác chiếu lên mặt cầu, cuộn chậm lên trên.
//    4. Gợn sóng: mỗi đòn đánh (tối đa 4) sinh sóng tròn lan từ điểm trúng, làm méo
//       bong bóng và tạo vòng sáng chạy.
//    + Viền sáng bám theo silhouette nhân vật (8 mẫu alpha).
//
//  Blend: ONE, ONE_MINUS_SRC_ALPHA (premultiplied). Tọa độ quad: v_local 0..1, y = 0 ở dưới.
// ============================================================================
precision mediump float;

varying vec2 v_local;

uniform sampler2D u_tex;        // atlas nhân vật
uniform vec4  u_uvRect;         // ô sprite trong atlas (UV): xy = min, zw = max
uniform vec4  u_spriteBox;      // vị trí sprite trong quad (0..1): xy = min, zw = max
uniform vec2  u_texel;          // 1 / kích thước atlas
uniform float u_rimRadius;      // bán kính viền silhouette (texel): 3 Mobile, 5 PC
uniform float u_time;           // giây
uniform float u_strength;       // 0..1, game nội suy khi bật / tắt khiên
uniform vec3  u_gold;           // màu kim quang, ví dụ vec3(1.0, 0.8, 0.32)
uniform vec4  u_hits[4];        // xy = điểm trúng (tọa độ quad), z = thời điểm trúng (s), w = lực 0..1
uniform vec4  u_bubble;         // xy = tâm bong bóng, zw = bán kính (tọa độ quad), ví dụ (0.5, 0.5, 0.47, 0.47)

const float HIT_LIFE = 1.2;

// ---------------------------------------------------------------------------
float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
}

// Lấy texel sprite theo tọa độ quad; ngoài khung sprite trả về trong suốt (không đọc lấn atlas).
vec4 spriteAt(vec2 q) {
  vec2 s = (q - u_spriteBox.xy) / (u_spriteBox.zw - u_spriteBox.xy);
  if (s.x < 0.0 || s.y < 0.0 || s.x > 1.0 || s.y > 1.0) return vec4(0.0);
  return texture2D(u_tex, mix(u_uvRect.xy, u_uvRect.zw, s));
}

// Khoảng cách tới cạnh ô lục giác: 0 ở cạnh, 0,5 ở tâm ô.
float hexEdge(vec2 p) {
  vec2 r = vec2(1.0, 1.7320508);
  vec2 h = r * 0.5;
  vec2 a = mod(p, r) - h;
  vec2 b = mod(p - h, r) - h;
  vec2 g = dot(a, a) < dot(b, b) ? a : b;
  vec2 ag = abs(g);
  return 0.5 - max(dot(ag, vec2(0.5, 0.8660254)), ag.x);
}

// ---------------------------------------------------------------------------
void main() {
  vec2 q = v_local;

  // ---- 4. Gợn sóng từ các điểm trúng đòn ----
  vec2 warp = vec2(0.0);
  float ringLight = 0.0;
  for (int i = 0; i < 4; i++) {
    vec4 h = u_hits[i];
    float age = u_time - h.z;
    if (age < 0.0 || age > HIT_LIFE || h.w <= 0.0) continue;
    vec2 dv = q - h.xy;
    float dist = length(dv);
    float decay = exp(-4.0 * age) * h.w;
    float wave = sin(42.0 * dist - 20.0 * age) * decay * exp(-5.0 * dist);
    warp += (dist > 1e-4 ? dv / dist : vec2(0.0)) * wave * 0.018;
    float front = age * 0.9;                                   // mặt sóng lan ra
    ringLight += exp(-pow((dist - front) / 0.035, 2.0)) * decay;
    ringLight += exp(-dist * dist / 0.004) * decay * 1.5;      // chớp tại điểm trúng
  }

  // ---- 2. Bong bóng Fresnel ----
  vec2 bq = (q + warp - u_bubble.xy) / u_bubble.zw;
  float d = length(bq);
  float inside = 1.0 - smoothstep(0.97, 1.0, d);               // mép mềm
  float nz = sqrt(max(0.0, 1.0 - d * d));                      // pháp tuyến giả của mặt cầu
  float fresnel = pow(1.0 - nz, 3.0);
  float pulse = 0.85 + 0.15 * sin(u_time * 3.0);

  // ---- 3. Lưới phù văn lục giác trên mặt cầu ----
  vec2 sph = bq / (0.35 + nz);                                 // ánh xạ giả cầu: dồn ô về phía viền
  vec2 hp = sph * 4.2 + vec2(0.0, u_time * 0.25);
  float hexLine = 1.0 - smoothstep(0.0, 0.045, hexEdge(hp));
  float shimmer = smoothstep(0.45, 0.9, vnoise(hp * 0.7 + u_time * 0.4));
  float hex = hexLine * (0.25 + 0.75 * fresnel) * (0.35 + 0.65 * shimmer);

  float shieldLight = (fresnel * 0.95 + hex * 0.45 + ringLight * 1.1) * inside * pulse;
  float shieldAlpha = (fresnel * 0.55 + hex * 0.2 + 0.05 + ringLight * 0.4) * inside;

  // ---- 1. Sprite + viền silhouette ----
  vec4 base = spriteAt(q);
  vec2 texToQuad = (u_spriteBox.zw - u_spriteBox.xy) / (u_uvRect.zw - u_uvRect.xy) * u_texel;
  float m = 0.0;
  for (int k = 0; k < 8; k++) {
    float a = float(k) * 0.7853982;
    m = max(m, spriteAt(q + vec2(cos(a), sin(a)) * u_rimRadius * texToQuad).a);
  }
  float rim = clamp(m - base.a, 0.0, 1.0);
  float flow = vnoise(q * vec2(18.0, 10.0) + vec2(0.0, -u_time * 2.5));   // kim quang bốc lên
  float rimLight = rim * (0.55 + 0.9 * flow) * pulse;

  vec3 rgb = base.rgb * base.a + u_gold * (shieldLight + rimLight) * u_strength;
  float alpha = max(base.a, max(shieldAlpha, rimLight * 0.8) * u_strength);
  gl_FragColor = vec4(rgb, clamp(alpha, 0.0, 1.0));
}
