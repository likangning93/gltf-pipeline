'use strict';
var fs = require('fs');
var path = require('path');
var clone = require('clone');
var loadGltfUris = require('../../lib/loadGltfUris');
var addPipelineExtras = require('../../lib/addPipelineExtras');
var removeUnusedVertices = require('../../lib/removeUnusedVertices');
var byteLengthForComponentType = require('../../lib/byteLengthForComponentType');
var numberOfComponentsForType = require('../../lib/numberOfComponentsForType');


describe('removeUnusedVertices', function() {
    var indices = new Uint16Array([0, 1, 2]);
    var indicesOneUnused = new Uint16Array([0, 2]);
    var indicesTwoUnused = new Uint16Array([1]);
    var attributeOne = new Buffer(new Float32Array([0, 1, 2, 3, 4, 5, 6, 7, 8]).buffer);
    var attributeTwo = new Buffer(new Uint16Array([0, 1, 2, 3, 4, 5]).buffer);
    var attributesBuffer = Buffer.concat([attributeOne, attributeTwo]);

    var testGltf = {
        accessors : {
            indexAccessor : {
                byteOffset : 0,
                byteStride : 0,
                bufferView : 'indexBufferView',
                componentType : 5123,
                type : 'SCALAR'
            },
            attributeAccessor1 : {
                byteStride : 0,
                bufferView : 'attributesBufferView',
                componentType : 5126,
                count : 3,
                byteOffset : 0,
                type : 'VEC3'
            },
            attributeAccessor2 : {
                byteStride : 0,
                bufferView : 'attributesBufferView',
                componentType : 5123,
                count : 3,
                byteOffset : attributeOne.length,
                type : 'VEC2'
            }
        },
        buffers : {
            indexBuffer : {
                type : 'arraybuffer',
                extras : {
                    _pipeline : {}
                }
            },
            attributesBuffer : {
                byteLength : attributesBuffer.length,
                type : 'arraybuffer',
                extras : {
                    _pipeline : {
                        source : attributesBuffer
                    }
                }
            }
        },
        bufferViews : {
            indexBufferView : {
                buffer : 'indexBuffer',
                byteOffset : 0,
                target : 34963
            },
            attributesBufferView : {
                buffer : 'attributesBuffer',
                byteOffset : 0,
                byteLength : attributesBuffer.length,
                target : 34962
            }
        },
        meshes : {
            mesh : {
                primitives : [
                    {
                        attributes : {
                            POSITION : 'attributeAccessor1',
                            NORMAL : 'attributeAccessor2'
                        },
                        indices : 'indexAccessor'
                    }
                ]
            }
        }
    };

    it('does not remove any data if all attribute values are accessed', function() {
        var gltf = clone(testGltf);
        var gltfIndexBuffer = gltf.buffers.indexBuffer;
        var indexBuffer = new Buffer(indices.buffer);
        gltfIndexBuffer.extras._pipeline.source = indexBuffer;
        gltfIndexBuffer.byteLength = indexBuffer.length;
        gltf.bufferViews.indexBufferView.byteLength = indexBuffer.length;
        var indexAccessor = gltf.accessors.indexAccessor;
        indexAccessor.count = indices.length;
        var attributesBuffer = gltf.buffers.attributesBuffer;
        var byteLength = attributesBuffer.byteLength;
        removeUnusedVertices(gltf);
        expect(attributesBuffer.byteLength).toEqual(byteLength);
    });

    it('removes one unused attribute', function() {
        var gltf = clone(testGltf);
        var gltfIndexBuffer = gltf.buffers.indexBuffer;
        var indexBuffer = new Buffer(indicesOneUnused.slice(0).buffer);
        gltfIndexBuffer.extras._pipeline.source = indexBuffer;
        gltfIndexBuffer.byteLength = indexBuffer.length;
        gltf.bufferViews.indexBufferView.byteLength = indexBuffer.length;
        var indexAccessor = gltf.accessors.indexAccessor;
        indexAccessor.count = indicesOneUnused.length;
        var attributesBuffer = gltf.buffers.attributesBuffer;
        var byteLength = attributesBuffer.byteLength;
        var attributeAccessor1 = gltf.accessors.attributeAccessor1;
        var expectBytesDropped1 = numberOfComponentsForType(attributeAccessor1.type) * byteLengthForComponentType(attributeAccessor1.componentType);
        var attributeAccessor2 = gltf.accessors.attributeAccessor2;
        var expectBytesDropped2 = numberOfComponentsForType(attributeAccessor2.type) * byteLengthForComponentType(attributeAccessor2.componentType);
        var expectBytesDropped = expectBytesDropped1 + expectBytesDropped2;
        removeUnusedVertices(gltf);
        expect(attributesBuffer.byteLength + expectBytesDropped).toEqual(byteLength);

        var expectAttribute1 = [0, 1, 2, 6, 7, 8];
        var expectAttribute2 = [0, 1, 4, 5];
        var attributesSource = Uint8Array.from(attributesBuffer.extras._pipeline.source);
        var check1 = new Float32Array(attributesSource.buffer, attributeAccessor1.byteOffset, expectAttribute1.length);
        var check2 = new Uint16Array(attributesSource.buffer, attributeAccessor2.byteOffset, expectAttribute2.length);
        var i;
        for (i = 0; i < expectAttribute1.length; i++) {
            expect(expectAttribute1[i]).toEqual(check1[i]);
        }
        for (i = 0; i < expectAttribute2.length; i++) {
            expect(expectAttribute2[i]).toEqual(check2[i]);
        }

        var expectIndices = [0, 1];
        var indicesSource = Uint8Array.from(gltf.buffers.indexBuffer.extras._pipeline.source);
        var check = new Uint16Array(indicesSource.buffer, 0, expectIndices.length);
        for (i = 0; i < expectIndices.length; i++) {
            expect(expectIndices[i]).toEqual(check[i]);
        }
    });

    it('removes two unused attributes', function() {
        var gltf = clone(testGltf);
        var gltfIndexBuffer = gltf.buffers.indexBuffer;
        var indexBuffer = new Buffer(indicesTwoUnused.slice(0).buffer);
        gltfIndexBuffer.extras._pipeline.source = indexBuffer;
        gltfIndexBuffer.byteLength = indexBuffer.length;
        gltf.bufferViews.indexBufferView.byteLength = indexBuffer.length;
        var indexAccessor = gltf.accessors.indexAccessor;
        indexAccessor.count = indicesTwoUnused.length;
        var attributesBuffer = gltf.buffers.attributesBuffer;
        var byteLength = attributesBuffer.byteLength;
        var attributeAccessor1 = gltf.accessors.attributeAccessor1;
        var expectBytesDropped1 = numberOfComponentsForType(attributeAccessor1.type) * byteLengthForComponentType(attributeAccessor1.componentType);
        var attributeAccessor2 = gltf.accessors.attributeAccessor2;
        var expectBytesDropped2 = numberOfComponentsForType(attributeAccessor2.type) * byteLengthForComponentType(attributeAccessor2.componentType);
        var expectBytesDropped = 2 * (expectBytesDropped1 + expectBytesDropped2);
        removeUnusedVertices(gltf);
        expect(attributesBuffer.byteLength + expectBytesDropped).toEqual(byteLength);

        var expectAttribute1 = [3, 4, 5];
        var expectAttribute2 = [2, 3];
        var attributesSource = Uint8Array.from(attributesBuffer.extras._pipeline.source);
        var check1 = new Float32Array(attributesSource.buffer, attributeAccessor1.byteOffset, expectAttribute1.length);
        var check2 = new Uint16Array(attributesSource.buffer, attributeAccessor2.byteOffset, expectAttribute2.length);
        var i;
        for (i = 0; i < expectAttribute1.length; i++) {
            expect(expectAttribute1[i]).toEqual(check1[i]);
        }
        for (i = 0; i < expectAttribute2.length; i++) {
            expect(expectAttribute2[i]).toEqual(check2[i]);
        }

        var expectIndices = [0];
        var indicesSource = Uint8Array.from(gltfIndexBuffer.extras._pipeline.source);
        var check = new Uint16Array(indicesSource.buffer, 0, expectIndices.length);
        for (i = 0; i < expectIndices.length; i++) {
            expect(expectIndices[i]).toEqual(check[i]);
        }
    });

    it('handles when primitives use the same accessors with different indices', function() {
        var gltf = clone(testGltf);
        var gltfIndexBuffer = gltf.buffers.indexBuffer;
        var indexBuffer = new Buffer(indicesTwoUnused.slice(0).buffer);
        gltfIndexBuffer.extras._pipeline.source = indexBuffer;
        gltfIndexBuffer.byteLength = indexBuffer.length;
        var indexBufferView = gltf.bufferViews.indexBufferView;
        indexBufferView.byteLength = indexBuffer.length;

        var gltfIndexBuffer2 = clone(gltfIndexBuffer);
        var indexBuffer2 = new Buffer(indicesOneUnused.slice(0).buffer);
        gltfIndexBuffer2.extras._pipeline.source = indexBuffer2;
        gltfIndexBuffer2.byteLength = indexBuffer2.length;
        gltf.buffers.indexBuffer2 = gltfIndexBuffer2;

        var gltfIndexBufferView2 = clone(indexBufferView);
        gltfIndexBufferView2.buffer = 'indexBuffer2';
        gltfIndexBufferView2.byteLength = indexBuffer2.length;
        gltf.bufferViews.indexBufferView2 = gltfIndexBufferView2;

        var gltfIndexAccessor = gltf.accessors.indexAccessor;
        gltfIndexAccessor.count = indicesTwoUnused.length;
        var gltfIndexAccessor2 = clone(gltfIndexAccessor);
        gltfIndexAccessor2.count = indicesOneUnused.length;
        gltfIndexAccessor2.bufferView = 'indexBufferView2';
        gltf.accessors.indexAccessor2 = gltfIndexAccessor2;

        var mesh2 = clone(gltf.meshes.mesh);
        mesh2.primitives[0].indices = 'indexAccessor2';
        gltf.meshes.mesh2 = mesh2;

        // All indices are used, 0 and 2 by the first primitive and 1 by the other
        var attributesBuffer = gltf.buffers.attributesBuffer;
        var byteLength = attributesBuffer.byteLength;
        removeUnusedVertices(gltf);
        expect(attributesBuffer.byteLength).toEqual(byteLength);
    });

    it('removes parts of the buffer based on the attribute type if the stride is 0', function(){
        var indices = [0,1,2,0,2,3];
        var indicesBuffer = new Buffer(indices.length * 2);
        for (var i = 0; i < indices.length; i++) {
            indicesBuffer.writeUInt16LE(indices[i], i * 2);
        }

        var positions = [
            0,0,0,
            0,1,0,
            1,1,0,
            1,0,0,
            2,2,2,
            2,2,2,
            2,2,2
        ];
        var positionsBuffer = new Buffer(positions.length * 4);
        for (var i = 0; i < positions.length; i++) {
            positionsBuffer.writeFloatLE(positions[i], i * 4);
        }

        var dataBuffer = Buffer.concat([indicesBuffer, positionsBuffer]);

        var testGltf = {
            "accessors": {
                "accessor_index": {
                    "bufferView": "index_view",
                    "byteOffset": 0,
                    "componentType": 5123,
                    "count": 6,
                    "type": "SCALAR",
                    "extras": {
                        "_pipeline": {}
                    }
                },
                "accessor_position": {
                    "bufferView": "position_view",
                    "byteOffset": 0,
                    "componentType": 5126,
                    "count": 4,
                    "type": "VEC3",
                    "extras": {
                        "_pipeline": {}
                    }
                }
            },
            "bufferViews": {
                "position_view": {
                    "buffer": "buffer_0",
                    "byteOffset": 6 * 2,
                    "byteLength": 7 * 3 * 4,
                    "target": 34962,
                    "extras": {
                        "_pipeline": {}
                    }
                },
                "index_view": {
                    "buffer": "buffer_0",
                    "byteOffset": 0,
                    "byteLength": 6 * 2,
                    "target": 34963,
                    "extras": {
                        "_pipeline": {}
                    }
                }
            },
            "buffers": {
                "buffer_0": {
                    "uri": "data:",
                    "byteLength": indices.length * 2 + positions.length * 4,
                    "extras": {
                        "_pipeline": {
                            "source": dataBuffer
                        }
                    }
                }
            },
            "meshes": {
                "mesh_square": {
                    "name": "square",
                    "primitives": [
                        {
                            "attributes": {
                                "POSITION": "accessor_position"
                            },
                            "indices": "accessor_index"
                        }
                    ]
                }
            }
        };

        removeUnusedVertices(testGltf);
        expect(testGltf.buffers["buffer_0"].byteLength).toEqual(6 * 2 + 4 * 3 * 4);
    });

    it('handles 8 bit indices', function(){
        var indices = [0,1,2,0,2,3];
        var indicesBuffer = new Buffer(indices.length);
        for (var i = 0; i < indices.length; i++) {
            indicesBuffer.writeUInt8(indices[i], i);
        }

        var positions = [
            0,0,0,
            0,1,0,
            1,1,0,
            1,0,0,
            2,2,2,
            2,2,2,
            2,2,2
        ];
        var positionsBuffer = new Buffer(positions.length * 4);
        for (var i = 0; i < positions.length; i++) {
            positionsBuffer.writeFloatLE(positions[i], i * 4);
        }

        var dataBuffer = Buffer.concat([indicesBuffer, positionsBuffer]);

        var testGltf = {
            "accessors": {
                "accessor_index": {
                    "bufferView": "index_view",
                    "byteOffset": 0,
                    "componentType": 5121, // unsigned short
                    "count": 6,
                    "type": "SCALAR",
                    "extras": {
                        "_pipeline": {}
                    }
                },
                "accessor_position": {
                    "bufferView": "position_view",
                    "byteOffset": 0,
                    "componentType": 5126,
                    "count": 4,
                    "type": "VEC3",
                    "extras": {
                        "_pipeline": {}
                    }
                }
            },
            "bufferViews": {
                "position_view": {
                    "buffer": "buffer_0",
                    "byteOffset": 6,
                    "byteLength": 7 * 3 * 4,
                    "target": 34962,
                    "extras": {
                        "_pipeline": {}
                    }
                },
                "index_view": {
                    "buffer": "buffer_0",
                    "byteOffset": 0,
                    "byteLength": 6,
                    "target": 34963,
                    "extras": {
                        "_pipeline": {}
                    }
                }
            },
            "buffers": {
                "buffer_0": {
                    "uri": "data:",
                    "byteLength": indices.length + positions.length * 4,
                    "extras": {
                        "_pipeline": {
                            "source": dataBuffer
                        }
                    }
                }
            },
            "meshes": {
                "mesh_square": {
                    "name": "square",
                    "primitives": [
                        {
                            "attributes": {
                                "POSITION": "accessor_position"
                            },
                            "indices": "accessor_index"
                        }
                    ]
                }
            }
        };

        removeUnusedVertices(testGltf);
        expect(testGltf.buffers["buffer_0"].byteLength).toEqual(6 + 4 * 3 * 4);
    });
});