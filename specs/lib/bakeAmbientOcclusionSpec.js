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

var gltfPath = './specs/data/boxTexturedUnoptimized/CesiumTexturedBoxTest.gltf';

describe('bakeAmbientOcclusion', function() {
    var boxGltf;

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
    for (var i = 0; i < positions.length; i++) {
        positionsBuffer.writeFloatLE(positions[i], i * 4);
    }
    var normalsBuffer = new Buffer(normals.length * 4);
    for (var i = 0; i < normals.length; i++) {
        normalsBuffer.writeFloatLE(normals[i], i * 4);
    }
    var uvsBuffer = new Buffer(uvs.length * 4);
    for (var i = 0; i < uvs.length; i++) {
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
        fs.readFile(gltfPath, function(err, data) {
            if (err) {
                throw err;
            }
            else {
                boxGltf = JSON.parse(data);
                addPipelineExtras(boxGltf);
                loadGltfUris(boxGltf, path.dirname(gltfPath), function(err, gltf) {
                    if (err) {
                        throw err;
                    }
                    done();
                });
            }
        });
    });

    it('correctly processes a basic 2-triangle square primitive', function() {
        var scene = testGltf.scenes[testGltf.scene];
        var options = {
            "rayDepth" : 0.1,
            "resolution" : 10
        }
        var rayTracerScene = bakeAmbientOcclusion.generateRaytracerScene(scene, testGltf, options);
        var triangleSoup = rayTracerScene.triangleSoup;
        var texelPoints = rayTracerScene.texelPoints;
        expect(triangleSoup.length).toEqual(2);
        expect(texelPoints.length >= 36).toEqual(true); // barycentric coordinate precisions make this imprecise
        expect(texelPoints.length <= 46).toEqual(true); // at worst, all pixels on triangle diagonals are double sampled

        // because of the uniform scale, expect triangles to be bigger
    });
    
});
