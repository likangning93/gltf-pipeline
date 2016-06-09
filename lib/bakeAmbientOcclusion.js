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
var readAccessor = require('./requireAccessor');
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

function generateRaytracerScene(gltf, options) {
    // generates the triangle soup for each LOD
    // generates an array of points to sample from
    // TODO: figure out which extras to use/which pre-stages are needed
    // TODO: only read from accessors that are normals, positions, indices, uvs?

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

    // for each scene,
    var scenes = gltf.scenes;
    for (var sceneID in scenes) {
        if (scenes.hasOwnProperty(sceneID)) {

            // for each root node,
            var rootNodes = scenes[sceneID].nodes;
            for (var nodeID in rootNodes) {
                if (rootNodes.hasOwnProperty(nodeID)) {
                    var root = rootNodes;
                    // compute the nodes' childrens' flattened transform

                    // for each mesh

                    // process each primitive
                }
            }
        }
    }
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

