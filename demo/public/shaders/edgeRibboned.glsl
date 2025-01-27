#ifdef VERTEX_SHADER

precision highp float;
precision highp sampler2D;
precision highp usampler2D;
precision highp sampler2DArray;

layout(location = 0) in vec4 pos;

uniform mat4 uMatrix;
uniform vec2 centerLow;
uniform vec2 centerHigh;
uniform sampler2D paletteTexture;
uniform float lineWidth;
uniform vec2 viewport;

out vec4 v_color;

const float PI = 3.141592653;

vec2 calcWebMercatorCoord(vec2 coord) {
    float lon = (180.0 + coord.x) / 360.0;
    float lat = (180.0 - (180.0 / PI * log(tan(PI / 4.0 + coord.y * PI / 360.0)))) / 360.0;
    return vec2(lon, lat);
}

vec2 uvCorrection(vec2 uv, vec2 dim) {
    return clamp(uv, vec2(0.0), dim - vec2(1.0));
}

vec4 linearSampling(sampler2D texture, vec2 uv, vec2 dim) {
    vec4 tl = textureLod(texture, uv / dim, 0.0);
    vec4 tr = textureLod(texture, uvCorrection(uv + vec2(1.0, 0.0), dim) / dim, 0.0);
    vec4 bl = textureLod(texture, uvCorrection(uv + vec2(0.0, 1.0), dim) / dim, 0.0);
    vec4 br = textureLod(texture, uvCorrection(uv + vec2(1.0, 1.0), dim) / dim, 0.0);
    float mix_x = fract(uv.x);
    float mix_y = fract(uv.y);
    vec4 top = mix(tl, tr, mix_x);
    vec4 bottom = mix(bl, br, mix_x);
    return mix(top, bottom, mix_y);
}

float nan() {
    float a = 0.0;
    float b = 0.0;
    return a / b;
}

vec2 translateRelativeToEye(vec2 high, vec2 low) {
    vec2 highDiff = high - centerHigh;
    vec2 lowDiff = low - centerLow;
    return highDiff;
}

float altitude2Mercator(float lat, float alt) {
    const float earthRadius = 6371008.8;
    const float earthCircumference = 2.0 * PI * earthRadius;
    return alt / earthCircumference * cos(lat * PI / 180.0);
}

ivec2 indexToUV(sampler2D texture, int index) {

    int dim = textureSize(texture, 0).x;
    int x = index % dim;
    int y = index / dim;

    return ivec2(x, y);
}

float stitching(float coord, float minVal, float delta, float edge) {
    float order = mod(floor((coord - minVal) / delta), pow(2.0, edge));
    return -order * delta;
}

vec2 get_vector(vec2 beginVertex, vec2 endVertex) {
    return normalize(endVertex - beginVertex);
}

void main() {
    vec2 xy = vec2(0.0);
    vec2 p1 = pos.xy;
    vec2 p2 = pos.zw;
    float parity = float(gl_VertexID % 2);
    if(gl_VertexID / 2 == 0) {
        xy = p1;
    } else {
        xy = p2;
    }

    vec2 cn_vector = get_vector(p1, p2);
    // float lineWidth = distance(p1, p2) * 0.1;
    // float screenOffset = lineWidth / 2.0;

    vec3 view = vec3(0.0, 0.0, 1.0);
    vec2 v_offset = normalize(cross(view, vec3(cn_vector, 0.0))).xy * mix(1.0, -1.0, parity);
    vec2 v_pos = xy + v_offset * lineWidth / viewport;
    v_color = vec4(0.25 * float(gl_VertexID), 1, 1, 1);
    gl_Position = uMatrix * vec4(translateRelativeToEye(v_pos, vec2(0.0)), 0.0, 1.0);
}

#endif

#ifdef FRAGMENT_SHADER

precision highp float;

in vec4 v_color;
out vec4 fragColor;

void main() {
    fragColor = vec4(0.54, 0.97, 1.0, 1.0);

    // fragColor = v_color;
}

#endif