// Quad phủ màn hình cho shader Lôi Kiếp (GLSL ES 1.0).
// Đỉnh: (-1,-1), (1,-1), (-1,1), (1,1) vẽ bằng TRIANGLE_STRIP.
attribute vec2 a_position;
varying vec2 v_uv;

void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
