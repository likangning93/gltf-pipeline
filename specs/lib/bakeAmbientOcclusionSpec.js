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
    
});
