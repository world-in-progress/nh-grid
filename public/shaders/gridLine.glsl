#ifdef VERTEX_SHADER

precision highp float;
precision highp sampler2D;

uniform mat4 uMatrix;
uniform vec2 centerLow;
uniform vec2 centerHigh;
uniform sampler2D xTexture;
uniform sampler2D yTexture;

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


void main() {

    ivec2 indexMap[4] = ivec2[4](
        ivec2(0, 0),
        ivec2(1, 0),
        ivec2(1, 1),
        ivec2(0, 1)
    );

    ivec2 dim = textureSize(xTexture, 0).xy;
    int u = gl_InstanceID % dim.x;
    int v = gl_InstanceID / dim.x;

    vec2 x_WNES = texelFetch(xTexture, ivec2(u, v), 0).rg;
    vec2 y_WNES = texelFetch(yTexture, ivec2(u, v), 0).rg;

    ivec2 xyIndex = indexMap[gl_VertexID];
    float x = x_WNES[xyIndex.x];
    float y = y_WNES[xyIndex.y];

    gl_Position = uMatrix * vec4(translateRelativeToEye(vec2(x, y), vec2(0.0)), 0.0, 1.0);
}

#endif

#ifdef FRAGMENT_SHADER

precision highp float;

out vec4 fragColor;

void main() {
    fragColor = vec4(1.0);
}

#endif