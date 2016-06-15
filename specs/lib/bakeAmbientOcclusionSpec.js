'use strict';
var Cesium = require('cesium');
var CesiumMath = Cesium.Math;
var defined = Cesium.defined;
var Cartesian2 = Cesium.Cartesian2;
var Cartesian3 = Cesium.Cartesian3;
var Cartesian4 = Cesium.Cartesian4;

var fs = require('fs');
var path = require('path');
var clone = require('clone');
var loadGltfUris = require('../../lib/loadGltfUris');
var addPipelineExtras = require('../../lib/addPipelineExtras');
var bakeAmbientOcclusion = require('../../lib/bakeAmbientOcclusion');
var readAccessor = require('../../lib/readAccessor');

var boxGltfPath = './specs/data/boxTexturedUnoptimized/CesiumTexturedBoxTest.gltf';
var boxOverGroundGltfPath = './specs/data/ambientOcclusion/cube_over_ground.gltf';

describe('bakeAmbientOcclusion', function() {
    var boxGltf;
    var boxOverGroundGltf;

    var indices = [0,1,2,0,2,3];
    var indicesBuffer = new Buffer(indices.length * 2);
    for (var i = 0; i < indices.length; i++) {
        indicesBuffer.writeUInt16LE(indices[i], i * 2);
    }
    var positions = [
        0,0,0,
        0,1,0,
        1,1,0,
        1,0,0
    ];
    var normals = [
        0,0,1,
        0,0,1,
        0,0,1,
        0,0,1
    ];
    var uvs = [
        0.25,0.25,
        0.75,0.25,
        0.75,0.75,
        0.25,0.75
    ];
    var positionsBuffer = new Buffer(positions.length * 4);
    for (i = 0; i < positions.length; i++) {
        positionsBuffer.writeFloatLE(positions[i], i * 4);
    }
    var normalsBuffer = new Buffer(normals.length * 4);
    for (i = 0; i < normals.length; i++) {
        normalsBuffer.writeFloatLE(normals[i], i * 4);
    }
    var uvsBuffer = new Buffer(uvs.length * 4);
    for (i = 0; i < uvs.length; i++) {
        uvsBuffer.writeFloatLE(uvs[i], i * 4);
    }

    var dataBuffer = Buffer.concat([indicesBuffer, positionsBuffer, normalsBuffer, uvsBuffer]);

    var testGltf = {
        "accessors": {
            "accessor_index": {
                "bufferView": "index_view",
                "byteOffset": 0,
                "componentType": 5123,
                "count": 6,
                "type": "SCALAR"
            },
            "accessor_position": {
                "bufferView": "position_view",
                "byteOffset": 0,
                "componentType": 5126,
                "count": 4,
                "type": "VEC3"
            },
            "accessor_normal": {
                "bufferView": "normal_view",
                "byteOffset": 0,
                "componentType": 5126,
                "count": 4,
                "type": "VEC3"
            },
            "accessor_uv": {
                "bufferView": "uv_view",
                "byteOffset": 0,
                "componentType": 5126,
                "count": 4,
                "type": "VEC2"
            }
        },
        "bufferViews": {
            "index_view": {
                "buffer": "buffer_0",
                "byteOffset": 0,
                "byteLength": 6 * 2,
                "target": 34963
            },
            "position_view": {
                "buffer": "buffer_0",
                "byteOffset": 6 * 2,
                "byteLength": 4 * 3 * 4,
                "target": 34962
            },
            "normal_view": {
                "buffer": "buffer_0",
                "byteOffset": 6 * 2 + (4 * 3 * 4),
                "byteLength": 4 * 3 * 4,
                "target": 34962
            },
            "uv_view": {
                "buffer": "buffer_0",
                "byteOffset": 6 * 2 + (4 * 3 * 4) * 2,
                "byteLength": 4 * 2 * 4,
                "target": 34962
            }
        },
        "buffers": {
            "buffer_0": {
                "uri": "data:",
                "byteLength": indices.length * 2 + (positions.length + normals.length + uvs.length) * 4,
                "extras": {
                    "_pipeline": {
                        "source": dataBuffer
                    }
                }
            }
        },
        "scene": "defaultScene",
        "scenes": {
            "defaultScene": {
                "nodes": [
                    "squareNode"
                ]
            }
        },
        "nodes": {
            "squareNode": {
                "children": [],
                "matrix": [
                    2, 0, 0, 0,
                    0, 2, 0, 0,
                    0, 0, 2, 0,
                    0, 0, 0, 1
                ],
                "meshes": [
                    "mesh_square"
                ],
                "name": "square",
                "extras": {
                    "_pipeline": {}
                }
            }
        },
        "meshes": {
            "mesh_square": {
                "name": "square",
                "primitives": [
                    {
                        "attributes": {
                            "POSITION": "accessor_position",
                            "NORMAL": "accessor_normal",
                            "TEXCOORD_0": "accessor_uv"
                        },
                        "indices": "accessor_index"
                    }
                ]
            }
        }
    };



    beforeAll(function(done) {
        fs.readFile(boxGltfPath, function(err, data) {
            if (err) {
                throw err;
            }
            else {
                boxGltf = JSON.parse(data);
                addPipelineExtras(boxGltf);
                loadGltfUris(boxGltf, path.dirname(boxGltfPath), function(err, gltf) {
                    if (err) {
                        throw err;
                    }
                    done();
                });
            }
        });

        fs.readFile(boxOverGroundGltfPath, function(err, data) {
            if (err) {
                throw err;
            }
            else {
                boxOverGroundGltf = JSON.parse(data);
                addPipelineExtras(boxOverGroundGltf);
                loadGltfUris(boxOverGroundGltf, path.dirname(boxGltfPath), function(err, gltf) {
                    if (err) {
                        throw err;
                    }
                    done();
                });
            }
        });
    });

    // tetrahedron
    var point0 = new Cartesian3(0.0, -1.0, 1.0);
    var point1 = new Cartesian3(1.0, -1.0, -1.0);
    var point2 = new Cartesian3(-1.0, -1.0, -1.0);
    var point3 = new Cartesian3(0.0, 1.0, 0.0);

    var tetrahedron = [
        {positions: [point0, point1, point2]},
        {positions: [point0, point1, point3]},
        {positions: [point1, point2, point3]},
        {positions: [point2, point0, point3]}
    ];

    function testContainmentAndFitCartesian3(min, max, cartesian3s) {
        // check if the data in values is bounded by min and max precisely
        var minInValues = new Array(min.length).fill(Number.POSITIVE_INFINITY);
        var maxInValues = new Array(max.length).fill(Number.NEGATIVE_INFINITY);

        var data = cartesian3s;

        for (var i = 0; i < data.length; i++) {
            var values = [data[i].x, data[i].y, data[i].z];
            for (var j = 0; j < min.length; j++) {
                if (values[j] > max[j] || values[j] < min[j]) {
                    return false;
                }
                minInValues[j] = Math.min(minInValues[j], values[j]);
                maxInValues[j] = Math.max(maxInValues[j], values[j]);
            }
        }
        for (i = 0; i < min.length; i++) {
            if (!CesiumMath.equalsEpsilon(minInValues[i], min[i], CesiumMath.EPSILON7)) {
                return false;
            }
            if (!CesiumMath.equalsEpsilon(maxInValues[i], max[i], CesiumMath.EPSILON7)) {
                return false;
            }
        }
        return true;
    }

    it('correctly processes a basic 2-triangle square primitive', function() {
        var scene = testGltf.scenes[testGltf.scene];
        var options = {
            "rayDepth" : 0.1,
            "resolution" : 10
        };
        var raytracerScene = bakeAmbientOcclusion.generateRaytracerScene(testGltf, scene, options);
        var triangleSoup = raytracerScene.triangleSoup;
        var texelPoints = raytracerScene.texelPoints;

        // because of the uniform scale, expect triangles to be bigger
        var point0 = new Cartesian3(0.0, 0.0, 0.0);
        var point1 = new Cartesian3(0.0, 2.0, 0.0);
        var point2 = new Cartesian3(2.0, 2.0, 0.0);
        var point3 = new Cartesian3(2.0, 0.0, 0.0);
        var normal = new Cartesian3(0.0, 0.0, 1.0);

        var expectedPixelIndices = {
            22: 0, 23: 0, 24: 0, 25: 0, 26: 0, 27: 0,
            32: 0, 33: 0, 34: 0, 35: 0, 36: 0, 37: 0,
            42: 0, 43: 0, 44: 0, 45: 0, 46: 0, 47: 0,
            52: 0, 53: 0, 54: 0, 55: 0, 56: 0, 57: 0,
            62: 0, 63: 0, 64: 0, 65: 0, 66: 0, 67: 0,
            72: 0, 73: 0, 74: 0, 75: 0, 76: 0, 77: 0
        };

        ////////// check texel points //////////
        expect(texelPoints.length >= 36).toEqual(true); // barycentric coordinate precisions make this imprecise
        expect(texelPoints.length <= 46).toEqual(true); // at most, all pixels on triangle diagonals are double sampled

        // each texel point has a world position, world normal, pixel index, and buffer pointer
        var cartesian3s = [];
        for (var i = 0; i < texelPoints.length; i++) {
            var texelPoint = texelPoints[i];
            expect(Cartesian3.equalsEpsilon(texelPoint.normal, normal, CesiumMath.EPSILON7)).toEqual(true);
            expect(texelPoint.buffer.resolution).toEqual(10);
            expect(texelPoint.buffer.samples.length).toEqual(100);
            expect(expectedPixelIndices.hasOwnProperty(texelPoint.index)).toEqual(true);
            if (expectedPixelIndices.hasOwnProperty(texelPoint.index)) {
                expectedPixelIndices[texelPoint.index]++;
            }
            cartesian3s.push(texelPoint.position);
        }
        expect(testContainmentAndFitCartesian3([0.0, 0.0, 0.0], [2.0, 2.0, 0.0], cartesian3s)).toEqual(true);
        for (var id in expectedPixelIndices) {
            if (expectedPixelIndices.hasOwnProperty(id)) {
                expect(expectedPixelIndices[id] > 0).toEqual(true);
            }
        }

        ////////// check triangle soup //////////

        expect(triangleSoup.length).toEqual(2);

        var triangle0 = triangleSoup[0];
        var triangle1 = triangleSoup[1];

        expect(Cartesian3.equalsEpsilon(triangle0.positions[0], point0, CesiumMath.EPSILON7)).toEqual(true);
        expect(Cartesian3.equalsEpsilon(triangle0.positions[1], point1, CesiumMath.EPSILON7)).toEqual(true);
        expect(Cartesian3.equalsEpsilon(triangle0.positions[2], point2, CesiumMath.EPSILON7)).toEqual(true);

        expect(Cartesian3.equalsEpsilon(triangle1.positions[0], point0, CesiumMath.EPSILON7)).toEqual(true);
        expect(Cartesian3.equalsEpsilon(triangle1.positions[1], point2, CesiumMath.EPSILON7)).toEqual(true);
        expect(Cartesian3.equalsEpsilon(triangle1.positions[2], point3, CesiumMath.EPSILON7)).toEqual(true);
    });

    it('generates "all occluded (1.0)" for samples inside a closed tetrahedron', function() {
        var normals = [];
        for (var i = 0; i < 6; i++) {
            var values = [0.0, 0.0, 0.0];
            values[i % 3] = (i % 2) ? 1.0 : -1.0;
            var newNormal = Cartesian3.fromArray(values);
            normals.push(newNormal);
        }

        var aoBuffer = {
            resolution: 3,
            samples: new Array(9).fill(0.0),
            count: new Array(9).fill(0.0)
        };

        var texelPoints = [];

        for (i = 0; i < normals.length; i++) {
            texelPoints.push({
                position: Cartesian3.ZERO,
                normal: normals[i],
                index: i,
                buffer: aoBuffer
            });
        }

        var raytracerScene = {
            numberSamples : 16,
            rayDepth : 10.0,
            triangleSoup : tetrahedron,
            texelPoints : texelPoints,
            nearCull: 0.001
        };

        bakeAmbientOcclusion.generateOcclusionData(raytracerScene);

        var samples = aoBuffer.samples;
        var counts = aoBuffer.count;
        for (i = 0; i < 6; i++) {
            expect(samples[i]).toEqual(16.0);
            expect(counts[i]).toEqual(16);
        }
    });

    it('generates various levels of occlusion for samples in the mouth of an open tetrahedron', function() {
        var openTetrahedron = [tetrahedron[1], tetrahedron[2], tetrahedron[3]];

        var aoBuffer = {
            resolution: 2,
            samples: new Array(4).fill(0.0),
            count: new Array(4).fill(0.0)
        };

        var bottomCenter = new Cartesian3(0.0, -1.0, 0.0);

        var texelPoints = [
            {
                position: bottomCenter,
                normal: new Cartesian3(0.0, 1.0, 0.0),
                index: 0,
                buffer: aoBuffer
            },
            {
                position: bottomCenter,
                normal: new Cartesian3(0.0, -1.0, 0.0),
                index: 1,
                buffer: aoBuffer
            },
            {
                position: bottomCenter,
                normal: new Cartesian3(1.0, 0.0, 0.0),
                index: 2,
                buffer: aoBuffer
            }
        ];

        var raytracerScene = {
            numberSamples : 16,
            rayDepth : 10.0,
            triangleSoup : openTetrahedron,
            texelPoints : texelPoints,
            nearCull: 0.001
        };

        bakeAmbientOcclusion.generateOcclusionData(raytracerScene);

        var samples = aoBuffer.samples;

        expect(samples[0]).toEqual(16);
        expect(samples[1]).toEqual(0);
        expect(samples[2] > 6 && samples[2] < 10).toEqual(true); // randomized, but stratification should ensure this.
    });

    it('generates new images, textures, and materials with a new sampler', function() {
        var boxOverGroundGltfClone = clone(boxOverGroundGltf);
        var options = {
            numberSamples: 16,
            rayDepth: 1.0,
            resolution: 16
        };
        bakeAmbientOcclusion.bakeAmbientOcclusion(boxOverGroundGltfClone, options);

        expect(Object.keys(boxOverGroundGltfClone.images).length).toEqual(4);
        expect(Object.keys(boxOverGroundGltfClone.textures).length).toEqual(4);
        expect(Object.keys(boxOverGroundGltfClone.materials).length).toEqual(4);
        expect(Object.keys(boxOverGroundGltfClone.samplers).length).toEqual(2);
    })
});
