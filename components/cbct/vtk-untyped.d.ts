// Ambient typing for the one vtk.js module we use that ships without a .d.ts.
// (vtk.js is already in node_modules as Cornerstone's dependency; scene3d.ts imports its
// typed modules directly — this file only fills the marching-cubes gap, matching the API
// verified in node_modules/@kitware/vtk.js/Filters/General/ImageMarchingCubes.js.)
declare module '@kitware/vtk.js/Filters/General/ImageMarchingCubes' {
  import type vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
  import type vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData';

  export interface vtkImageMarchingCubes {
    setInputData(data: vtkImageData): void;
    setContourValue(v: number): void;
    getOutputData(): vtkPolyData;
  }

  const vtkImageMarchingCubesFactory: {
    newInstance(initialValues?: {
      contourValue?: number;
      computeNormals?: boolean;
      mergePoints?: boolean;
    }): vtkImageMarchingCubes;
  };
  export default vtkImageMarchingCubesFactory;
}
