import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';
import { environment } from '../../../../../environments/environment';
import { Auth } from '../../../../core/auth/auth';
import { BetaflightSerialService } from '../../../../core/services/betaflight-serial.service';
import { FlightControllerMetadata } from '../../../../models/flight-controller.models';
import { DroneDetail } from './drone-detail';

const droneUrl = `${environment.apiBaseUrl}/drones/syn-drone`;
const inspectionsUrl = `${environment.apiBaseUrl}/uavs/syn-drone/inspections`;

function setup(binding?: Record<string, unknown>) {
  const connectRealSerial = vi.fn<() => Promise<FlightControllerMetadata>>();
  TestBed.configureTestingModule({
    imports: [DroneDetail],
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 'syn-drone' }) } } },
      { provide: Auth, useValue: { user: signal({ role: 'Technician' }) } },
      {
        provide: BetaflightSerialService,
        useValue: { connectRealSerial, connectionState: signal('disconnected'), isWebSerialSupported: () => true },
      },
    ],
  });
  const http = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(DroneDetail);
  http.expectOne(droneUrl).flush({
    id: 'syn-drone', code: 'SYN-UAV', name: 'UAV thử nghiệm', activeFlightController: binding, batteryLevel: null,
  });
  http.expectOne(`${inspectionsUrl}/latest`).flush(null);
  http.expectOne((req) => req.url === `${droneUrl}/technical-inspections`).flush([]);
  fixture.detectChanges();
  const root = fixture.nativeElement as HTMLElement;
  return { fixture, root, http, connectRealSerial };
}

function enter(root: HTMLElement, selector: string, value: string): void {
  const input = root.querySelector<HTMLInputElement>(selector)!;
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

describe('Drone Detail — BRL-02 và BRL-04', () => {
  it('tái sử dụng UID thật, giữ firmware trống và hướng dẫn gỡ ghép cũ khi API trả 409', () => {
    const { fixture, root, http } = setup({ flightControllerUid: 'SYN-FC', isActive: true });
    expect(root.textContent).toContain('Chưa khai báo');
    root.querySelector<HTMLButtonElement>('[data-testid="fc-pair-form"] button[type="submit"]')!.click();
    const request = http.expectOne({ method: 'POST', url: `${droneUrl}/flight-controller` });
    expect(request.request.body.flightControllerUid).toBe('SYN-FC');
    expect(request.request.body.firmwareName).toBeUndefined();
    request.flush({ errorCode: 'FC_ALREADY_PAIRED' }, { status: 409, statusText: 'Conflict' });
    fixture.detectChanges();
    expect(root.querySelector('[role="alert"]')?.textContent).toMatch(/đang gắn.*khác.*ngắt kết nối.*cũ/i);
    expect(root.querySelector<HTMLInputElement>('#fcUid')?.value).toBe('SYN-FC');
    http.verify();
  });

  it.each(['metadata', 'disconnect'])('báo các mục thiếu sau đọc FC (%s) và giữ số đo nhập tay', async (mode) => {
    const { fixture, root, http, connectRealSerial } = setup();
    enter(root, '#bistVoltage', '24');
    if (mode === 'metadata') connectRealSerial.mockResolvedValue({ uid: 'SYN-FC' });
    else connectRealSerial.mockRejectedValue(new Error('Serial failed'));

    root.querySelector<HTMLButtonElement>('[data-testid="fc-connect-btn"]')!.click();
    await fixture.whenStable();
    fixture.detectChanges();

    const alert = root.querySelector('[data-testid="missing-metrics-alert"][role="alert"]');
    expect(alert?.textContent).toContain('Dung lượng pin');
    expect(alert?.textContent).toContain('Tín hiệu vô tuyến');
    expect(root.querySelector<HTMLInputElement>('#bistBattery')?.value).toBe('');
    expect(root.querySelector<HTMLInputElement>('#bistVoltage')?.value).toBe('24');
    expect(root.textContent).not.toMatch(/(^|\D)0%/);
    expect(root.querySelector('[data-testid="bist-manual-form"]')).not.toBeNull();
    http.verify();
  });

  it('hiển thị 400 METRICS_REQUIRED, sau đó lưu số đo thật và báo kết quả còn thiếu', () => {
    const { fixture, root, http } = setup();
    const submit = root.querySelector<HTMLButtonElement>('[data-testid="bist-submit-btn"]')!;
    enter(root, '#bistNotes', 'Ghi chú thử nghiệm');
    submit.click();
    const empty = http.expectOne({ method: 'POST', url: inspectionsUrl });
    expect(empty.request.body.metrics).toEqual([]);
    empty.flush({ errorCode: 'METRICS_REQUIRED' }, { status: 400, statusText: 'Bad Request' });
    fixture.detectChanges();
    expect(root.querySelector('[data-testid="missing-metrics-alert"]')?.textContent).toContain('Dung lượng pin');
    expect(root.querySelector<HTMLTextAreaElement>('#bistNotes')?.value).toBe('Ghi chú thử nghiệm');

    enter(root, '#bistBattery', '86');
    submit.click();
    const retry = http.expectOne({ method: 'POST', url: inspectionsUrl });
    expect(retry.request.body.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ metricCode: 'BATTERY_PERCENT', numericValue: 86 }),
    ]));
    expect(retry.request.body.metrics).toHaveLength(1);
    expect(retry.request.body.missingMetricCodes).toContain('RF_SIGNAL_QUALITY');
    retry.flush({
      id: 'syn-inspection', readiness: 'MaintenanceRequired',
      missingMetrics: ['FLIGHT_CONTROLLER'],
    });
    fixture.detectChanges();
    expect(root.querySelector('[data-testid="missing-metrics-alert"]')?.textContent).toContain('Tín hiệu vô tuyến');
    expect(root.querySelector('[data-testid="missing-metrics-alert"]')?.textContent).toContain('Flight Controller');
    expect(root.querySelector('[data-testid="drone-readiness-badge"]')?.textContent).toContain('Cần bảo trì');
    expect(root.querySelector<HTMLInputElement>('#bistBattery')?.value).toBe('86');
    http.verify();
  });
});
