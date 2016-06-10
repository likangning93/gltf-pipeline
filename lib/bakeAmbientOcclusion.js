'use strict';
var Cesium = require('cesium');
var CesiumMath = Cesium.Math;
var defined = Cesium.defined;
var defaultValue = Cesium.defaultValue;
var DeveloperError = Cesium.DeveloperError;
var Cartesian2 = Cesium.Cartesian2;
var Cartesian3 = Cesium.Cartesian3;
var Cartesian4 = Cesium.Cartesian4;
var Matrix2 = Cesium.Matrix2;
var Matrix3 = Cesium.Matrix3;
var Matrix4 = Cesium.Matrix4;

var Ray = Cesium.Ray;
var BaryCentricCoordinates = Cesium.barycentricCoordinates;
var byteLengthForComponentType = require('./byteLengthForComponentType');
var getAccessorByteStride = require('./getAccessorByteStride');
var numberOfComponentsForType = require('./numberOfComponentsForType');
var readAccessor = require('./readAccessor');
var nodeHelpers = require('./nodeHelpers');

module.exports = {
    bakeAmbientOcclusion: bakeAmbientOcclusion,
    generateRaytracerScene: generateRaytracerScene,
    processPrimitive: processPrimitive,
    generateOcclusionData: generateOcclusionData,
    naiveRaytrace: naiveRaytrace,
    generateRayMonteCarlo: generateRayMonteCarlo
};

function bakeAmbientOcclusion(gltf, options) {
    // make every instance of a primitive its own primitive
    // give every primitive its own unique material and texture entry

    // generate triangle soup from the gltf and texelPoints to sample from
    // -options: generate soup per primitive, per mesh, per node, or per scene
    // -start with just per primitive. TODO: add options to generate occluding soup at other levels in hierarchy

    // raytrace to textures per primitive -> with optional groundplane -> get from the gltf
    // -if no distance is provided, for now use the average of all triangle lengths?

    // add to the gltf

}

////////// loading //////////

function generateRaytracerScene(scene, gltf, options) {
    // generates an array of points to sample from
    // TODO: figure out which extras to use/which pre-stages are needed
    // TODO: only read from accessors that are normals, positions, indices, uvs?
    // TODO: scenes can have semioverlapping sets of primitives. handle this for texelPoint generation

    var accessors = gltf.accessors;

    // read all accessors in one go to avoid repeated read-and-conversion
    var bufferDataByAccessor = {};

    for (var accessorID in accessors) {
        if (accessors.hasOwnProperty(accessorID)) {
            var accessor = accessors[accessorID];
            bufferDataByAccessor[accessorID] = readAccessor(accessor, gltf);
        }
    }

    var rayTracerScene = {
        "RAY_DEPTH" : defaultValue(options.rayDepth, -1.0), // TODO: compute dynamic default ray depth
        "BUFFER_DATA_BY_ACCESSOR" : bufferDataByAccessor
    };

    // generate triangle soup over the whole scene
    // generate texelPoints over each primitive
    // TODO: currently assuming each primitive appears in the scene once. this is not true. figure out what to do.
    // traverse the scene and dump each node's mesh's primitive into the soup
    // generate all the world transform matrices
    nodeHelpers.computeFlatTransformScene(scene, gltf.nodes);
    var triangleSoup = [];
    var texelPoints = [];

    var addPrimitiveToSoup = function(primitive, aoBuffer, transform) {
        var indices = bufferDataByAccessor[primitive.indices];
        var positions = bufferDataByAccessor[primitive.attributes['POSITION']]; // TODO: look at style guide for this
        var normals = bufferDataByAccessor[primitive.attributes['NORMAL']]; // TODO: handle no normals case
        var uvs = bufferDataByAccessor[primitive.attributes['TEXCOORD_0']]; // TODO: handle more than one tex coord buffer?
        var numTriangles = indices.length;
        var inverse = new Matrix4();
        inverse = Matrix4.inverse(transform, inverse);

        // read each triangle's Cartesian3s using the index buffer
        for (var i = 0; i < numTriangles; i++) {
            var position0 = new Cartesian3(positions[i * 3]);
            var position1 = new Cartesian3(positions[i * 3 + 1]);
            var position2 = new Cartesian3(positions[i * 3 + 2]);

            var normal0 = new Cartesian3(normals[i * 3]);
            var normal1 = new Cartesian3(normals[i * 3 + 1]);
            var normal2 = new Cartesian3(normals[i * 3 + 2]);

            // generate texelPoints for this triangle
            var uv0 = uvs[i * 3];
            var uv1 = uvs[i * 3 + 1];
            var uv2 = uvs[i * 3 + 2];

            // figure out the pixel width in UV space of this primitive's AO texture
            // TODO: make sure UVs don't overlap or go beyond the tile boundaries. [0, 1] in all directions
            // TODO: this may involve making another set of texture coordinates
            var pixelWidth = 1.0 / aoBuffer.resolution;
            var uStep = Math.min(uv0.x, uv1.x, uv2.x);
            var vStep = Math.min(uv0.y, uv1.y, uv2.y);
            var uMax = Math.max(uv0.x, uv1.x, uv2.x);
            var vMax = Math.max(uv0.y, uv1.y, uv2.y);

            // perform a pixel march.
            // 0.0, 0.0 to width, width is the bottom left pixel
            // 1.0-width, 1.0-width to 1.0, 1.0 is the top right pixel
            uStep = Math.floor(uMin / pixelWidth) * pixelWidth + pixelWidth / 2.0;
            vStep = Math.floor(vMin / pixelWidth) * pixelWidth + pixelWidth / 2.0;
            var barycentric = new Cartesian3();
            var scratchCartesian3 = new Cartesian3();
            var scratchCartesian2 = new Cartesian2();
            while(uStep < uMax + pixelWidth) {
                while(vStep < vMax + pixelWidth) {
                    // TODO: incorporate option for sub-pixel samples
                    // use the triangle's uv coordinates to compute this texel's barycentric coordinates on the triangle
                    scratchCartesian2.x = uStep;
                    scratchCartesian2.y = vStep;
                    barycentric = BaryCentricCoordinates(scratchCartesian2, uv0, uv1, uv2, barycentric);

                    // use this barycentric coordinate to compute the local space position and normal on the triangle
                    var texelPosition = new Cartesian3();
                    var texelNormal = new Cartesian3();
                    sumBarycentric(barycentric, position0, position1, position2, scratchCartesian3, texelPosition);
                    sumBarycentric(barycentric, normal0, normal1, normal2, scratchCartesian3, texelNormal);

                    // transform to world space
                    Matrix4.multiplyByPoint(texelPosition, transform, texelPosition);
                    Matrix4.multiplyByPointAsVector(texelNormal, transform, texelNormal);

                    var texelPoint = {
                        "position": texelPosition,
                        "normal": texelNormal,
                        "buffer": aoBuffer
                    }

                    texelPoints.push(texelPoint);
                }
            }

            // generate a world space triangle geometry for the soup
            Matrix4.multiplyByPoint(position0, transform, position0);
            Matrix4.multiplyByPoint(position1, transform, position1);
            Matrix4.multiplyByPoint(position2, transform, position2);

            Matrix4.multiplyByPointAsVector(normal0, inverse, normal0);
            Matrix4.multiplyByPointAsVector(normal1, inverse, normal1);
            Matrix4.multiplyByPointAsVector(normal2, inverse, normal2);

            var normalAvg = new Cartesian3();
            normalAvg = Cartesian3.add(normal0, normal1, normalAvg);
            normalAvg = Cartesian3.add(normal2, normalAvg, normalAvg);
            normalAvg = Cartesian3.divideByScalar(normalAvg, 3.0, normalAvg);
            Cartesian3.normalize(normalAvg);

            var triangle = {
                "positions": [
                    position0, position1, position2
                ],
                "normal": normalAvg
            }
            triangleSoup.push(triangle);
        }
    }

    var addNodeToSoup = function(node) {
        var resolution = defaultValue(['resolution'], 128);
        var transform = node.extras._pipeline.flatTransform;
        for (var meshIndex in meshes) {
            var mesh = meshes[meshIndex];
            for (var primitiveIndex in mesh.primitives) {
                var aoBuffer = {
                    "resolution" : resolution,
                    "samples" : new Array(resolution * resolution).fill(0.0),
                    "count" : new Array(resolution * resolution).fill(0.0)
                }
                addPrimitiveToSoup(mesh.primitives[primitiveIndex], aoBuffer, transform);
            }
        }
    };


}


function processPrimitive(bufferDataByAccessor, primitive, transform, raytracerScene) {
    // generate world-space triangles from the primitive. map to hierarchy level name:
    // -world space coordinates
    // -average face normal
    // -TODO: if requested, bin the triangle into a uniform grid instead of adding it to the soup

    // generate texelPoints for primitive
    // -normal
    // -position
    // -UV coordinate -> can compute texture indices from this
    // -texture file ID
    // -TODO: implement supersampling as an option by adding more than one texelPoint for each texel
    // -need space to keep track of how many samples this texel has then
}

////////// computing AO //////////

function generateOcclusionData(raytracerScene) {
    // for each texelPoint in the raytracerScene:
        // pick a relevant triangle storage structure
        // pick a relevant texture to render to
        // for each of N rays:
            // for every triangle in the triangle soup:
                // check if intersect and intersect < distance
                // add contribution to texel
}

function naiveRaytrace(triangleSoup, ray) {
    // check ray against every triangle in the soup. return the nearest intersection.
}

function uniformGridRaytrace(triangleGrid, ray) {
    // TODO: implement!
}

function generateRayMonteCarlo(texelPoint) {
    // TODO: implement!
}

// borrowed straight from Cesium/Source/Core/IntersectionTests
var scratchEdge0 = new Cartesian3();
var scratchEdge1 = new Cartesian3();
var scratchPVec = new Cartesian3();
var scratchTVec = new Cartesian3();
var scratchQVec = new Cartesian3();

function rayTriangle(ray, p0, p1, p2, cullBackFaces) {
    if (!defined(ray)) {
        throw new DeveloperError('ray is required.');
    }
    if (!defined(p0)) {
        throw new DeveloperError('p0 is required.');
    }
    if (!defined(p1)) {
        throw new DeveloperError('p1 is required.');
    }
    if (!defined(p2)) {
        throw new DeveloperError('p2 is required.');
    }

    cullBackFaces = defaultValue(cullBackFaces, false);

    var origin = ray.origin;
    var direction = ray.direction;

    var edge0 = Cartesian3.subtract(p1, p0, scratchEdge0);
    var edge1 = Cartesian3.subtract(p2, p0, scratchEdge1);

    var p = Cartesian3.cross(direction, edge1, scratchPVec);
    var det = Cartesian3.dot(edge0, p);

    var tvec;
    var q;

    var u;
    var v;
    var t;

    if (cullBackFaces) {
        if (det < CesiumMath.EPSILON6) {
            return undefined;
        }

        tvec = Cartesian3.subtract(origin, p0, scratchTVec);
        u = Cartesian3.dot(tvec, p);
        if (u < 0.0 || u > det) {
            return undefined;
        }

        q = Cartesian3.cross(tvec, edge0, scratchQVec);

        v = Cartesian3.dot(direction, q);
        if (v < 0.0 || u + v > det) {
            return undefined;
        }

        t = Cartesian3.dot(edge1, q) / det;
    } else {
        if (Math.abs(det) < CesiumMath.EPSILON6) {
            return undefined;
        }
        var invDet = 1.0 / det;

        tvec = Cartesian3.subtract(origin, p0, scratchTVec);
        u = Cartesian3.dot(tvec, p) * invDet;
        if (u < 0.0 || u > 1.0) {
            return undefined;
        }

        q = Cartesian3.cross(tvec, edge0, scratchQVec);

        v = Cartesian3.dot(direction, q) * invDet;
        if (v < 0.0 || u + v > 1.0) {
            return undefined;
        }

        t = Cartesian3.dot(edge1, q) * invDet;
    }

    return t;
}

function sumBarycentric(barycentric, vector0, vector1, vector2, scratch, result) {
    Cartesian3.multiplyByScalar(vector0, barycentric.x, scratch);
    Cartesian3.add(result, scratch, result);
    Cartesian3.multiplyByScalar(vector1, barycentric.y, scratch);
    Cartesian3.add(result, scratch, result);
    Cartesian3.multiplyByScalar(vector2, barycentric.z, scratch);
    Cartesian3.add(result, scratch, result);
    return result;
}