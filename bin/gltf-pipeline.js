'use strict';
var argv = require('yargs').argv;
var path = require('path');
var Cesium = require('cesium');
var defaultValue = Cesium.defaultValue;
var defined = Cesium.defined;
var DeveloperError = Cesium.DeveloperError;
var gltfPipeline = require('../lib/gltfPipeline');
var processFileToDisk = gltfPipeline.processFileToDisk;

if (process.argv.length < 3 || defined(argv.h) || defined(argv.help)) {
    var help =
        'Usage: node ' + path.basename(__filename) + ' [path-to.gltf or path-to.bgltf] [OPTIONS]\n' +
        '  -i --input, input=PATH Read unoptimized glTF from the specified file.\n' +
        '  -o --output, output=PATH write optimized glTF to the specified file.\n' +
        '  -b --binary, write binary glTF file.\n' +
        '  -s --separate, writes out separate geometry/animation data files, shader files and textures instead of embedding them in the glTF file.\n' +
        '  -t --separateImage, write out separate textures, but embed geometry/animation data files, and shader files.\n' +
        '  -q, quantize the attributes of this model.\n' +
        '  --ao_diffuse, bake ambient occlusion into the diffuse texture.\n' +
        '  --ao_separate, bake ambient occlusion into a separate texture and modify the shader to use it.\n' +
        '  --ao_scene, specify which scene to bake AO for.\n' +
        '  --ao_rayDepth, ray distance for raytraced ambient occlusion.\n' +
        '  --ao_resolution, resolution along one dimension for each AO texture.\n' +
        '  --ao_samples, sample count for ambient occlusion\n';
    process.stdout.write(help);
    return;
}

var gltfPath = defaultValue(argv._[0], defaultValue(argv.i, argv.input));
var fileExtension = path.extname(gltfPath);
var fileName = path.basename(gltfPath, fileExtension);
var filePath = path.dirname(gltfPath);

var outputPath = defaultValue(argv._[1], defaultValue(argv.o, argv.output));
var binary = defaultValue(argv.b, defaultValue(argv.binary, false));
var separate = defaultValue(argv.s, defaultValue(argv.separate, false));
var separateImage = defaultValue(argv.t, defaultValue(argv.separateImage, false));
var quantize = defaultValue(argv.q, defaultValue(argv.quantize, false));

var ao_diffuse = defaultValue(argv.ao_diffuse, false);
var ao_scene = argv.ao_scene;
var ao_rayDepth = defaultValue(argv.ao_rayDepth, 1.0);
var ao_resolution = defaultValue(argv.ao_resolution, 128);
var ao_samples = defaultValue(argv.ao_samples, 16);

if (!defined(gltfPath)) {
    throw new DeveloperError('Input path is undefined.');
}

if (fileExtension !== '.glb' && fileExtension !== '.gltf') {
    throw new DeveloperError('Invalid glTF file.');
}

if (!defined(outputPath)) {
    // Default output.  For example, path/asset.gltf becomes path/asset-optimized.gltf
    outputPath = path.join(filePath, fileName + '-optimized' + fileExtension);
}

var options = {
    binary : binary,
    embed : !separate,
    embedImage : !separateImage,
    quantize : quantize,
    ao_diffuse : ao_diffuse,
    ao_scene : ao_scene,
    ao_rayDepth : ao_rayDepth,
    ao_resolution : ao_resolution,
    ao_samples : ao_samples
};

processFileToDisk(gltfPath, outputPath, options);
