'use strict';
var Cesium = require('cesium');
var CesiumMath = Cesium.Math;
var clone = require('clone');
var defined = Cesium.defined;
var defaultValue = Cesium.defaultValue;
var DeveloperError = Cesium.DeveloperError;
var Cartesian2 = Cesium.Cartesian2;
var Cartesian3 = Cesium.Cartesian3;
var Matrix3 = Cesium.Matrix3;
var Matrix4 = Cesium.Matrix4;
var PNG = require('pngjs').PNG;
var Quaternion = Cesium.Quaternion;

var Ray = Cesium.Ray;
var baryCentricCoordinates = Cesium.barycentricCoordinates;
var readAccessor = require('./readAccessor');
var nodeHelpers = require('./nodeHelpers');

module.exports = {
    bakeAmbientOcclusion: bakeAmbientOcclusion,
    generateRaytracerScene: generateRaytracerScene,
    generateOcclusionData: generateOcclusionData
};

var scratchRay = new Ray();
var cartesian3Scratch1 = new Cartesian3();
var cartesian3Scratch2 = new Cartesian3();
var cartesian2Scratch = new Cartesian2();
var quaternionScratch = new Quaternion();
var matrix3Scratch = new Matrix3();

function bakeAmbientOcclusion(gltf, options) {
    // required: each mesh occurs once in the scene

    // generate triangle soup from the gltf and texelPoints to sample from
    // -options: generate soup per primitive, per mesh, per node, or per scene
    // -start with per scene. TODO: add options to generate occluding soup at other levels in hierarchy
    var sceneID = gltf.scene;
    if (!defined(sceneID)) {
        sceneID = Object.keys(gltf.scenes)[0];
    }

    var scene = gltf.scenes[sceneID];

    var raytracerScene = generateRaytracerScene(scene, gltf, options);

    // raytrace to textures per primitive get from the gltf
    generateOcclusionData(raytracerScene);

    ////////// add to the gltf //////////

    // add sampler for all AO
    gltf.samplers['pipeline_ao_sampler'] = {
        extras: {
            _pipeline: {
                deleteExtras: true
            }
        }
    };

    var meshes = gltf.meshes;

    var resolution = options.resolution;
    var pngScratch = new PNG({
        width: resolution,
        height: resolution,
        filterType: -1
    });

    // for each primitive
    for (var meshID in meshes) {
        if (meshes.hasOwnProperty(meshID)) {
            var primitives = meshes[meshID].primitives;
            for (var primitiveID in primitives) {
                if (primitives.hasOwnProperty(primitiveID)) {
                    var primitive = primitives[primitiveID];

                    // add image with data uri
                    var aoBuffer = raytracerScene.aoBufferByPrimitive[meshID + " " + primitiveID];
                    for (var y = 0; y < pngScratch.height; y++) {
                        for (var x = 0; x < pngScratch.width; x++) {
                            var aoBufferIdx = pngScratch.width * y + x;
                            var idx = aoBufferIdx << 2;
                            var value = 255;
                            if (aoBuffer.count[aoBufferIdx] > 0) {
                                value = 255.0 * (1.0 - aoBuffer.samples[aoBufferIdx] / aoBuffer.count[aoBufferIdx]);
                            }
                            pngScratch.data[idx  ] = value;
                            pngScratch.data[idx+1] = value;
                            pngScratch.data[idx+2] = value;
                            pngScratch.data[idx+3] = 255; // opacity
                        }
                    }

                    var pngBuffer = PNG.sync.write(pngScratch);

                    var imageName = 'ao_' + meshID + ' ' + primitiveID + "_image";

                    gltf.images[imageName] = {
                        name: imageName,
                        uri: "data:",
                        extras: {
                            _pipeline: {
                                deleteExtras: true,
                                source: pngBuffer,
                                extension: '.png'
                            }
                        }
                    };

                    // add texture
                    var textureName = 'ao_' + meshID + ' ' + primitiveID + "_texture";
                    gltf.textures[textureName] = {
                        sampler: 'pipeline_ao_sampler',
                        source: imageName,
                        extras: {
                            _pipeline: {
                                deleteExtras: true
                            }
                        }
                    };

                    // add material
                    // - clone an existing material with appropriate technique (basically, has diffuse: string)
                    var materialName = 'ao_' + meshID + ' ' + primitiveID + "_material";
                    var aoMaterial;
                    var materials = gltf.materials;
                    for (var materialID in materials) {
                        if (materials.hasOwnProperty(materialID)) {
                            var material = materials[materialID];
                            if (defined(material.values) && defined(material.values.diffuse)) {
                                if (typeof material.values.diffuse === "string") {
                                    aoMaterial = clone(material);
                                    break;
                                }
                            }
                        }
                    }
                    if (!defined(aoMaterial)) {
                        throw new DeveloperError('Could not find a material with a suitable technique to copy!');
                    }
                    aoMaterial.values.diffuse = textureName;
                    materials[materialName] = aoMaterial;

                    // attach to primitive
                    // - for now, just replace the existing material for this primitive
                    primitive.material = materialName;
                }
            }
        }
    }
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
            bufferDataByAccessor[accessorID] = readAccessor(gltf, accessor);
        }
    }

    var raytracerScene = {
        bufferDataByAccessor: bufferDataByAccessor,
        numberSamples: defaultValue(options.numberSamples, 16),
        rayDepth: defaultValue(options.rayDepth, 1.0), // TODO: compute dynamic default ray depth?
        triangleSoup: [],
        texelPoints: [],
        aoBufferByPrimitive: {},
        nearCull: 0.5 / options.resolution
    };

    // generate triangle soup over the whole scene
    // generate texelPoints over each primitive
    // TODO: currently assuming each primitive appears in the scene once. this is not true. figure out what to do.
    // traverse the scene and dump each node's mesh's primitive into the soup
    // generate all the world transform matrices
    nodeHelpers.computeFlatTransformScene(scene, gltf.nodes);

    var parameters = {
        meshes: gltf.meshes,
        raytracerScene: raytracerScene,
        resolution: options.resolution
    };

    var rootNodeNames = scene.nodes;
    var allNodes = gltf.nodes;
    for (var nodeID in rootNodeNames) {
        if (rootNodeNames.hasOwnProperty(nodeID)) {
            var rootNodeName = rootNodeNames[nodeID];
            nodeHelpers.depthFirstTraversal(allNodes[rootNodeName], allNodes, addNodeToSoup, parameters);
        }
    }

    return raytracerScene;
}

function addNodeToSoup(parameters, node) {
    var resolution = defaultValue(parameters.resolution, 128);
    var transform = node.extras._pipeline.flatTransform;
    var meshNames = node.meshes;
    for (var meshIndex in meshNames) {
        if (meshNames.hasOwnProperty(meshIndex)) {
            var meshID = meshNames[meshIndex];
            var mesh = parameters.meshes[meshID];
            var primitives = mesh.primitives;
            for (var primitiveID in primitives) {
                if (primitives.hasOwnProperty(primitiveID)) {
                    processPrimitive(parameters, meshID + " " + primitiveID, primitives[primitiveID], transform);
                }
            }
        }
    }
}

function processPrimitive(parameters, meshPrimitiveID, primitive, transform) {
    var raytracerScene = parameters.raytracerScene;
    var bufferDataByAccessor = raytracerScene.bufferDataByAccessor;
    var indices = bufferDataByAccessor[primitive.indices].data;
    var positions = bufferDataByAccessor[primitive.attributes.POSITION].data; // TODO: look at style guide for this
    var normals = bufferDataByAccessor[primitive.attributes.NORMAL].data; // TODO: handle no normals case
    var uvs = bufferDataByAccessor[primitive.attributes.TEXCOORD_0].data; // TODO: handle more than one tex coord buffer?
    var numTriangles = indices.length / 3;
    var inverse = new Matrix4();
    inverse = Matrix4.inverse(transform, inverse);
    var resolution = parameters.resolution;

    var aoBuffer = {
        resolution: resolution,
        samples: new Array(resolution * resolution).fill(0.0),
        count: new Array(resolution * resolution).fill(0.0)
    };

    raytracerScene.aoBufferByPrimitive[meshPrimitiveID] = aoBuffer;

    // read each triangle's Cartesian3s using the index buffer
    for (var i = 0; i < numTriangles; i++) {
        var index0 = indices[i * 3];
        var index1 = indices[i * 3 + 1];
        var index2 = indices[i * 3 + 2];

        var position0 = Cartesian3.clone(positions[index0]);
        var position1 = Cartesian3.clone(positions[index1]);
        var position2 = Cartesian3.clone(positions[index2]);

        var normal0 = normals[index0];
        var normal1 = normals[index1];
        var normal2 = normals[index2];

        // generate texelPoints for this triangle
        var uv0 = uvs[index0];
        var uv1 = uvs[index1];
        var uv2 = uvs[index2];

        // figure out the pixel width in UV space of this primitive's AO texture
        // TODO: make sure UVs don't overlap or go beyond boundaries
        // TODO: this may involve making another set of texture coordinates
        // TODO: borrow from conservative rasterization: http://http.developer.nvidia.com/GPUGems2/gpugems2_chapter42.html
        var pixelWidth = 1.0 / resolution;
        var uMin = Math.min(uv0.x, uv1.x, uv2.x);
        var vMin = Math.min(uv0.y, uv1.y, uv2.y);
        var uMax = Math.max(uv0.x, uv1.x, uv2.x);
        var vMax = Math.max(uv0.y, uv1.y, uv2.y);

        // perform a pixel march.
        // 0.0, 0.0 to width, width is the bottom left pixel
        // 1.0-width, 1.0-width to 1.0, 1.0 is the top right pixel
        var halfWidth = pixelWidth / 2.0;
        uMin = Math.floor(uMin / pixelWidth) * pixelWidth + halfWidth;
        vMin = Math.floor(vMin / pixelWidth) * pixelWidth + halfWidth;
        uMax = Math.floor(uMax / pixelWidth) * pixelWidth + halfWidth;
        vMax = Math.floor(vMax / pixelWidth) * pixelWidth + halfWidth;

        var barycentric = cartesian3Scratch2;

        var uStep = uMin;
        while(uStep < uMax) {
            var vStep = vMin;
            while(vStep < vMax) {
                // TODO: incorporate option for sub-pixel samples
                // use the triangle's uv coordinates to compute this texel's barycentric coordinates on the triangle
                cartesian2Scratch.x = uStep;
                cartesian2Scratch.y = vStep;
                barycentric = baryCentricCoordinates(cartesian2Scratch, uv0, uv1, uv2, barycentric);

                // not in triangle
                if (barycentric.x < 0.0 || barycentric.y < 0.0 || barycentric.z < 0.0) {
                    vStep += pixelWidth;
                    continue;
                }

                // use this barycentric coordinate to compute the local space position and normal on the triangle
                var texelPosition = new Cartesian3();
                var texelNormal = new Cartesian3();
                sumBarycentric(barycentric, position0, position1, position2, cartesian3Scratch1, texelPosition);
                sumBarycentric(barycentric, normal0, normal1, normal2, cartesian3Scratch1, texelNormal);

                // transform to world space
                Matrix4.multiplyByPoint(transform, texelPosition, texelPosition);
                Matrix4.multiplyByPointAsVector(transform, texelNormal, texelNormal);
                Cartesian3.normalize(texelNormal, texelNormal);

                var texelPoint = {
                    position: texelPosition,
                    normal: texelNormal,
                    index : Math.floor(uStep / pixelWidth) + Math.floor(vStep / pixelWidth) * resolution,
                    buffer: aoBuffer
                };
                raytracerScene.texelPoints.push(texelPoint);
                vStep += pixelWidth;
            }
            uStep += pixelWidth;
        }

        // generate a world space triangle geometry for the soup
        Matrix4.multiplyByPoint(transform, position0, position0);
        Matrix4.multiplyByPoint(transform, position1, position1);
        Matrix4.multiplyByPoint(transform, position2, position2);

        var triangle = {
            positions: [
                position0, position1, position2
            ]
        };
        raytracerScene.triangleSoup.push(triangle);
    }
}

////////// computing AO //////////

function generateOcclusionData(raytracerScene) {
    var triangleSoup = raytracerScene.triangleSoup;
    var texelPoints = raytracerScene.texelPoints;
    var numberSamples = raytracerScene.numberSamples;
    var sqrtNumberSamples = Math.floor(Math.sqrt(numberSamples));

    // for each texelPoint in the raytracerScene:
    for (var i = 0; i < texelPoints.length; i++) {
        var texelPoint = texelPoints[i];
        // pick a relevant triangle storage structure and texture to render to
        var triangles = triangleSoup;
        var aoBuffer = texelPoint.buffer;
        var aoBufferIndex = texelPoint.index;

        // for each of N rays:
        for (var j = 0; j < numberSamples; j++) {
            var sampleRay = generateJitteredRay(texelPoint, j, sqrtNumberSamples);
            aoBuffer.count[aoBufferIndex]++;
            var nearestIntersect = naiveRaytrace(triangles, sampleRay, raytracerScene.nearCull);

            if (nearestIntersect < raytracerScene.rayDepth) {
                aoBuffer.samples[aoBufferIndex] += 1.0;
            }
        }
    }
}

function naiveRaytrace(triangleSoup, ray, nearCull) {
    // check ray against every triangle in the soup. return the nearest intersection.
    var minIntersect = Number.POSITIVE_INFINITY;
    for (var triangleSoupIndex = 0; triangleSoupIndex < triangleSoup.length; triangleSoupIndex++) {
        var positions = triangleSoup[triangleSoupIndex].positions;
        var distance = rayTriangle(ray, positions[0], positions[1], positions[2], false);
        if (defined(distance) && distance > nearCull) {
            minIntersect = Math.min(distance, minIntersect);
        }
    }
    return minIntersect;
}

function generateJitteredRay(texelPoint, sampleNumber, sqrtNumberSamples) {
    // Stratified (jittered) Sampling with javascript's own rand function
    // Based on notes here: http://graphics.ucsd.edu/courses/cse168_s14/ucsd/CSE168_11_Random.pdf

    // Produces samples based on a grid of dimension sqrtNumberSamples x sqrtNumberSamples
    var cellWidth = 1.0 / sqrtNumberSamples;
    var s = (sampleNumber % sqrtNumberSamples) * cellWidth + (Math.random() / sqrtNumberSamples);
    var t = Math.floor(sampleNumber / sqrtNumberSamples) * cellWidth + (Math.random() / sqrtNumberSamples);

    // generate ray on a y-up hemisphere with cosine weighting (more rays around the normal)
    var u = 2.0 * Math.PI * s;
    var v = Math.sqrt(1.0 - t);

    var randomDirection = scratchRay.direction;
    randomDirection.x = v * Math.cos(u);
    randomDirection.y = t;
    randomDirection.z = v * Math.sin(u);

    // orient with texelPoint normal
    var normal = texelPoint.normal;
    var theta = Math.acos(normal.y); // dot product of normal with y-up is normal.y
    var axis = Cartesian3.cross(randomDirection, normal, cartesian3Scratch1);
    var rotation = Quaternion.fromAxisAngle(axis, theta, quaternionScratch);
    var matrix = Matrix3.fromQuaternion(rotation, matrix3Scratch);
    
    scratchRay.origin = texelPoint.position;
    scratchRay.direction = Matrix3.multiplyByVector(matrix, randomDirection, scratchRay.direction);
    return scratchRay;
}

// borrowed straight from Cesium/Source/Core/IntersectionTests
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

    var scratchEdge0 = cartesian3Scratch1;
    var scratchEdge1 = cartesian3Scratch2;

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
