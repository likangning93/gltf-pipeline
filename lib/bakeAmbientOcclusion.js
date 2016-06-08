'use strict';
var Cesium = require('cesium');
var defined = Cesium.defined;
var DeveloperError = Cesium.DeveloperError;
var Cartesian3 = Cesium.Cartesian3;
var Ray = Cesium.Ray;
var BaryCentricCoordinates = Cesium.barycentricCoordinates;

module.exports = [
    'bakeAmbientOcclusion',
    'generateRaytracerScene',
    'processPrimitive',
    'raytrace',
    'rayTriangle'
]

function bakeAmbientOcclusion(gltf, options) {
    // give every primitive its own unique material and texture entry

    // generate triangle soup from the gltf and texelPoints to sample from
    // -options: generate soup per primitive, per mesh, per node, or per scene
    // -start with just per primitive. TODO: add options to generate occluding soup at other levels in hierarchy

    // raytrace to textures per primitive -> with optional groundplane -> get from the gltf
    // -if no distance is provided, for now use the average of all triangle lengths?

    // add to the gltf

}

function generateRaytracerScene(gltf, options) {
    // generates the triangle soup for each LOD
    // generates an array of points to sample from

    // read indices buffer
    // read positions buffer
    // read normals buffer. TODO: autogenerate smooth normals if needed. separate stage?
    // read UVs buffer

    // for each scene,
        // for each node,

            // compute the node's flattened transform

                // for each mesh

                    // process each primitive

}

function processPrimitive(gltf, primitive, transform, raytracerScene) {
    // generate world-space triangles from the primitive. map to hierarchy level name:
    // -world space coordinates
    // -average face normal

    // generate texelPoints for primitive
    // -normal
    // -position
    // -UV coordinate -> can compute texture indices from this
    // -texture file ID
}

function raytrace(texelPointsPerScene, texturesPerScene, triangleSoupPerScene) {

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

