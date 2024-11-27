#ifdef VERTEX_SHADER

precision highp float;
precision highp sampler2D;
precision highp usampler2D;

uniform mat4 uMatrix;
uniform vec2 centerLow;
uniform vec2 centerHigh;
uniform sampler2D xTexture;
uniform sampler2D yTexture;
uniform sampler2D paletteTexture;
uniform usampler2D levelTexture;
uniform usampler2D indexTexture;

out vec3 v_color;

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
        ivec2(0, 1),
        ivec2(1, 1)
    );

    ivec2 dim = textureSize(indexTexture, 0).xy;
    int index_u = gl_InstanceID % dim.x;
    int index_v = gl_InstanceID / dim.x;
    int storageId = int(texelFetch(indexTexture, ivec2(index_u, index_v), 0).r);

    int storage_u = storageId % dim.x;
    int storage_v = storageId / dim.x;

    vec2 xs = texelFetch(xTexture, ivec2(storage_u, storage_v), 0).rg;
    vec2 ys = texelFetch(yTexture, ivec2(storage_u, storage_v), 0).rg;
    int level = int(texelFetch(levelTexture, ivec2(storage_u, storage_v), 0).r);

    ivec2 xyIndex = indexMap[gl_VertexID];
    float x = xs[xyIndex.x];
    float y = ys[xyIndex.y];

    v_color = texelFetch(paletteTexture, ivec2(level, 0), 0).rgb;
    gl_Position = uMatrix * vec4(translateRelativeToEye(vec2(x, y), vec2(0.0)), 0.0, 1.0);
}

#endif

#ifdef FRAGMENT_SHADER

precision highp float;

in vec3 v_color;
out vec4 fragColor;

void main() {
    fragColor = vec4(v_color, 0.3);
}

#endif