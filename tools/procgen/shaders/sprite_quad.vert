// Quad bao khiên Kim Quang (GLSL ES 1.0).
// a_position: góc quad theo px thế giới; a_local: 0..1 trong quad (y = 0 ở dưới).
attribute vec2 a_position;
attribute vec2 a_local;
uniform mat3 u_viewProj;   // px thế giới -> clip space (camera 2D)
varying vec2 v_local;

void main() {
  v_local = a_local;
  vec3 c = u_viewProj * vec3(a_position, 1.0);
  gl_Position = vec4(c.xy, 0.0, 1.0);
}
