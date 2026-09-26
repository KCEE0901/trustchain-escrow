import { act, fireEvent, render, screen } from '@testing-library/react';
import FileDropZone from '../../../components/ui/FileDropZone';

function makeFile(name, type, sizeBytes = 1024) {
  const file = new File([new Uint8Array(Math.min(sizeBytes, 1024))], name, { type });
  Object.defineProperty(file, 'size', { value: sizeBytes });
  return file;
}

describe('FileDropZone validation', () => {
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  afterEach(() => {
    if (originalCreateObjectURL) URL.createObjectURL = originalCreateObjectURL;
    else delete URL.createObjectURL;
    if (originalRevokeObjectURL) URL.revokeObjectURL = originalRevokeObjectURL;
    else delete URL.revokeObjectURL;
    jest.restoreAllMocks();
  });

  function selectFiles(files) {
    fireEvent.change(document.querySelector('input[type="file"]'), { target: { files } });
  }

  it('reports oversized video before starting upload', async () => {
    const onUpload = jest.fn();
    const onFilesAccepted = jest.fn();
    URL.createObjectURL = jest.fn(() => 'blob:video');
    const { container } = render(
      <FileDropZone onUpload={onUpload} onFilesAccepted={onFilesAccepted} maxSizeBytes={10} />,
    );

    await act(async () => selectFiles([makeFile('large.mp4', 'video/mp4', 11)]));

    expect(container.querySelector('[role="alert"]')).toHaveTextContent(/too large/i);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(onFilesAccepted).not.toHaveBeenCalled();
    expect(onUpload).not.toHaveBeenCalled();
  });

  it('reports unsupported MIME type before starting upload', async () => {
    const onUpload = jest.fn();
    const onFilesAccepted = jest.fn();
    const { container } = render(
      <FileDropZone onUpload={onUpload} onFilesAccepted={onFilesAccepted} />,
    );

    await act(async () => selectFiles([makeFile('evidence.mov', 'video/quicktime')]));

    expect(container.querySelector('[role="alert"]')).toHaveTextContent(/unsupported type/i);
    expect(onFilesAccepted).not.toHaveBeenCalled();
    expect(onUpload).not.toHaveBeenCalled();
  });

  it('reports dimension and duration failures before starting upload', async () => {
    const onUpload = jest.fn();
    URL.createObjectURL = jest.fn(() => 'blob:video');
    URL.revokeObjectURL = jest.fn();
    const createElement = document.createElement.bind(document);
    let video;
    jest.spyOn(document, 'createElement').mockImplementation((tagName, ...args) => {
      const element = createElement(tagName, ...args);
      if (tagName === 'video') {
        video = element;
        Object.defineProperty(video, 'videoWidth', { value: 5000 });
        Object.defineProperty(video, 'videoHeight', { value: 5000 });
        Object.defineProperty(video, 'duration', { value: 301 });
      }
      return element;
    });
    const { container } = render(<FileDropZone onUpload={onUpload} />);

    await act(async () => {
      selectFiles([makeFile('long.mp4', 'video/mp4')]);
      fireEvent(video, new Event('loadedmetadata'));
    });

    const alert = container.querySelector('[role="alert"]');
    expect(alert).toHaveTextContent(/width exceeds/i);
    expect(alert).toHaveTextContent(/height exceeds/i);
    expect(alert).toHaveTextContent(/duration exceeds/i);
    expect(onUpload).not.toHaveBeenCalled();
  });

  it('starts upload only after valid media metadata has loaded', async () => {
    const onUpload = jest.fn();
    URL.createObjectURL = jest.fn(() => 'blob:video');
    URL.revokeObjectURL = jest.fn();
    const createElement = document.createElement.bind(document);
    let video;
    jest.spyOn(document, 'createElement').mockImplementation((tagName, ...args) => {
      const element = createElement(tagName, ...args);
      if (tagName === 'video') {
        video = element;
        Object.defineProperty(video, 'videoWidth', { value: 1920 });
        Object.defineProperty(video, 'videoHeight', { value: 1080 });
        Object.defineProperty(video, 'duration', { value: 120 });
      }
      return element;
    });
    render(<FileDropZone onUpload={onUpload} />);
    const file = makeFile('valid.mp4', 'video/mp4');

    await act(async () => {
      selectFiles([file]);
      expect(onUpload).not.toHaveBeenCalled();
      fireEvent(video, new Event('loadedmetadata'));
    });

    expect(onUpload).toHaveBeenCalledWith(file, expect.any(Function));
  });
});