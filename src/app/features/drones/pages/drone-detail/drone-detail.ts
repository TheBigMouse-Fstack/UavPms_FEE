import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { Auth } from '../../../../core/auth/auth';
import { BetaflightSerialService } from '../../../../core/services/betaflight-serial.service';
import {
  DroneReadinessStatus,
  droneReadinessLabel,
  resolveDroneReadiness,
  SubmitUavInspectionRequest,
  UavInspectionConclusion,
  UavInspectionMetricInput,
  UavInspectionRecord,
  UavInspectionSourceType,
  UavRecord,
} from '../../../../models/drone-management.models';
import { describeHttpError, readBackendError } from '../../../../shared/errors/business-error-messages';
import { statusLabel } from '../../../../shared/status/status';
import {
  canPerformDroneBist,
  canViewDroneTechnicalHistory,
  formatVietnamDateTime,
  MultiRolePrincipal,
} from '../../../../shared/utils';
import { DroneManagementApi } from '../../data-access/drone-management-api';

const SOURCE_LABELS: Readonly<Record<string, string>> = {
  manual: 'Nhập thủ công',
  fc: 'Đọc từ Flight Controller',
  bist: 'Kiểm định BIST',
};

const BIST_NUMERIC_FIELDS = [
  { field: 'batteryPercent', code: 'BATTERY_PERCENT', label: 'Dung lượng pin (%)', subsystem: 'Power', unit: '%', minimum: 50 },
  { field: 'batteryVoltage', code: 'BATTERY_VOLTAGE', label: 'Điện áp pin (V)', subsystem: 'Power', unit: 'V', minimum: 21 },
  { field: 'gpsSatelliteCount', code: 'GPS_SATELLITES', label: 'Số vệ tinh GNSS', subsystem: 'Navigation', unit: 'sats', minimum: 10 },
  { field: 'rfSignalQuality', code: 'RF_SIGNAL_QUALITY', label: 'Tín hiệu vô tuyến (%)', subsystem: 'Communication', unit: '%', minimum: 70 },
] as const;

const BIST_CHECK_FIELDS = [
  { field: 'framePassed', code: 'FRAME_INTEGRITY', label: 'Khung thân', subsystem: 'Airframe' },
  { field: 'propellersPassed', code: 'PROPELLERS_OK', label: 'Cánh quạt', subsystem: 'Propulsion' },
  { field: 'motorsPassed', code: 'MOTORS_OK', label: 'Động cơ', subsystem: 'Propulsion' },
  { field: 'cameraPassed', code: 'CAMERA_PAYLOAD_OK', label: 'Camera / Gimbal', subsystem: 'Payload' },
] as const;

const METRIC_LABELS = new Map<string, string>([
  ...[...BIST_NUMERIC_FIELDS, ...BIST_CHECK_FIELDS].map(({ code, label }) => [code, label] as const),
  ['BATTERY_HEALTH', 'Tình trạng pin'],
  ['GPS_RTK_FIX', 'Định vị GNSS'],
  ['RF_LINK_TELEMETRY', 'Liên kết vô tuyến'],
  ['FLIGHT_CONTROLLER', 'Flight Controller'],
  ['FRAME_BODY', 'Khung thân'],
  ['PROP_INTEGRITY', 'Cánh quạt'],
  ['MOTORS', 'Động cơ'],
  ['CAMERA_PAYLOAD', 'Camera / Gimbal'],
]);

function missingCodes(metrics: readonly UavInspectionMetricInput[]): readonly string[] {
  return metrics
    .filter((metric) => metric.numericValue == null && metric.boolValue == null)
    .map((metric) => metric.metricCode);
}

function timestampOf(iso?: string | null): number {
  if (!iso) return 0;
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sortHistoryDesc(records: readonly UavInspectionRecord[]): readonly UavInspectionRecord[] {
  return [...records].sort((a, b) => timestampOf(b.completedAt) - timestampOf(a.completedAt));
}

@Component({
  selector: 'app-drone-detail',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './drone-detail.html',
  styleUrl: './drone-detail.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DroneDetail {
  private readonly api = inject(DroneManagementApi);
  private readonly fcSerial = inject(BetaflightSerialService);
  private readonly auth = inject(Auth);
  private readonly route = inject(ActivatedRoute);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly droneId = this.route.snapshot.paramMap.get('id') ?? '';
  protected readonly drone = signal<UavRecord | null>(null);
  protected readonly history = signal<readonly UavInspectionRecord[]>([]);
  protected readonly loading = signal(true);
  protected readonly historyLoading = signal(false);
  protected readonly submittingBist = signal(false);
  protected readonly fcBusy = signal(false);

  protected readonly pageError = signal('');
  protected readonly historyError = signal('');
  protected readonly bistError = signal('');
  protected readonly bistSuccess = signal('');
  protected readonly fcError = signal('');
  protected readonly fcSuccess = signal('');
  private readonly reportedMissingMetrics = signal<readonly string[] | null>(null);
  protected readonly missingMetricLabels = computed(() => {
    const codes = this.reportedMissingMetrics() ?? this.history()[0]?.missingMetricCodes ?? [];
    return [...new Set(codes.map((code) => METRIC_LABELS.get(code) ?? 'Chỉ số kỹ thuật chưa xác định'))];
  });
  protected readonly bistCheckFields = BIST_CHECK_FIELDS;

  protected readonly serialState = this.fcSerial.connectionState;
  protected readonly serialSupported = typeof this.fcSerial.isWebSerialSupported === 'function'
    ? this.fcSerial.isWebSerialSupported()
    : true;

  // Hỗ trợ multi-role union theo C-02: chỉ Technician và SystemAdmin được thao tác BIST/FC.
  protected readonly canEditBist = computed(() =>
    canPerformDroneBist(this.auth.user() as MultiRolePrincipal | null),
  );
  protected readonly canViewHistory = computed(() =>
    canViewDroneTechnicalHistory(this.auth.user() as MultiRolePrincipal | null),
  );

  protected readonly readiness = computed<DroneReadinessStatus>(() => {
    const latest = this.history()[0];
    if (latest) return latest.readiness;
    const current = this.drone();
    if (!current) return 'MaintenanceRequired';
    return resolveDroneReadiness({ technicalHealth: current.technicalHealth });
  });

  protected readonly readinessText = computed(() => droneReadinessLabel(this.readiness()));

  protected readonly fcForm = this.fb.nonNullable.group({
    flightControllerUid: ['', [Validators.required]],
    boardIdentifier: [''],
    firmwareName: [''],
    firmwareVersion: [''],
  });

  protected readonly bistForm = this.fb.nonNullable.group({
    sourceType: ['manual' as UavInspectionSourceType, [Validators.required]],
    conclusion: ['Passed' as UavInspectionConclusion, [Validators.required]],
    batteryPercent: this.fb.control<number | null>(null, [Validators.min(0), Validators.max(100)]),
    batteryVoltage: this.fb.control<number | null>(null, Validators.min(0)),
    gpsSatelliteCount: this.fb.control<number | null>(null, Validators.min(0)),
    rfSignalQuality: this.fb.control<number | null>(null, [Validators.min(0), Validators.max(100)]),
    framePassed: this.fb.control<boolean | null>(null),
    propellersPassed: this.fb.control<boolean | null>(null),
    motorsPassed: this.fb.control<boolean | null>(null),
    cameraPassed: this.fb.control<boolean | null>(null),
    notes: [''],
  });

  constructor() {
    if (!this.droneId) {
      this.loading.set(false);
      this.pageError.set('Không tìm thấy mã định danh UAV hợp lệ.');
      return;
    }
    this.loadDroneDetail();
  }

  protected loadDroneDetail(): void {
    this.loading.set(true);
    this.pageError.set('');
    this.api
      .getDrone(this.droneId)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.loading.set(false)),
      )
      .subscribe({
        next: (record) => {
          this.drone.set(record);
          if (record.activeFlightController) {
            this.fcForm.patchValue({
              flightControllerUid: record.activeFlightController.flightControllerUid,
              boardIdentifier: record.activeFlightController.boardIdentifier ?? '',
              firmwareName: record.activeFlightController.firmwareName ?? '',
              firmwareVersion: record.activeFlightController.firmwareVersion ?? '',
            });
          }
          this.loadLatestInspection();
        },
        error: (err: unknown) => {
          this.pageError.set(describeHttpError(err, 'Không thể tải thông tin chi tiết UAV.'));
        },
      });
  }

  private loadLatestInspection(): void {
    if (!this.canViewHistory()) {
      this.history.set([]);
      this.historyError.set('Vai trò hiện tại không có quyền xem lịch sử kiểm định kỹ thuật.');
      return;
    }

    this.api
      .getLatestUavInspection(this.droneId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (latest) => this.loadInspectionHistory(latest),
        error: () => this.loadInspectionHistory(),
      });
  }

  protected loadInspectionHistory(latest: UavInspectionRecord | null = null): void {
    if (!this.canViewHistory()) return;

    this.historyLoading.set(true);
    this.historyError.set('');
    this.api
      .getTechnicalInspections(this.droneId, 1, 20)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.historyLoading.set(false)),
      )
      .subscribe({
        next: (list) => {
          const records = latest ? [latest, ...list.filter((item) => item.id !== latest.id)] : list;
          this.history.set(sortHistoryDesc(records));
        },
        error: (err: unknown) => {
          this.historyError.set(describeHttpError(err, 'Không thể tải lịch sử kiểm định kỹ thuật.'));
        },
      });
  }

  protected async readFlightControllerSerial(): Promise<void> {
    if (!this.canEditBist()) return;
    this.fcError.set('');
    this.fcSuccess.set('');
    this.fcBusy.set(true);
    try {
      const metadata = await this.fcSerial.connectRealSerial();
      if (!metadata) {
        this.fcError.set('Không đọc được thông tin Flight Controller qua cổng Serial.');
        return;
      }
      this.fcForm.patchValue({
        flightControllerUid: metadata.uid,
        boardIdentifier: metadata.boardIdentifier ?? '',
        firmwareName: metadata.firmwareName ?? '',
        firmwareVersion: metadata.firmwareVersion ?? '',
      });
      this.bistForm.controls.sourceType.setValue('fc');
      this.fcSuccess.set(`Đã đọc Flight Controller: ${metadata.uid}`);
    } catch {
      this.fcError.set('Không thể kết nối cổng Serial của Flight Controller.');
    } finally {
      // Serial chỉ cung cấp nhận dạng FC. Các số đo chưa có vẫn cần bổ sung.
      this.reportedMissingMetrics.set(missingCodes(this.buildInspectionMetrics()));
      this.fcBusy.set(false);
    }
  }

  protected pairFlightController(): void {
    if (!this.canEditBist()) return;
    this.fcError.set('');
    this.fcSuccess.set('');
    if (this.fcForm.invalid) {
      this.fcForm.markAllAsTouched();
      this.fcError.set('Vui lòng nhập mã định danh (UID) của Flight Controller.');
      return;
    }

    const raw = this.fcForm.getRawValue();
    this.fcBusy.set(true);
    this.api
      .pairFlightController(this.droneId, {
        flightControllerUid: raw.flightControllerUid.trim(),
        boardIdentifier: raw.boardIdentifier.trim() || undefined,
        firmwareName: raw.firmwareName.trim() || undefined,
        firmwareVersion: raw.firmwareVersion.trim() || undefined,
      })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.fcBusy.set(false)),
      )
      .subscribe({
        next: (binding) => {
          this.drone.update((current) => (current ? { ...current, activeFlightController: binding } : current));
          this.fcSuccess.set('Đã ghép nối Flight Controller thành công.');
        },
        error: (err: unknown) => {
          this.fcError.set(describeHttpError(err, 'Không thể ghép nối Flight Controller.'));
        },
      });
  }

  protected unpairFlightController(): void {
    if (!this.canEditBist()) return;
    this.fcError.set('');
    this.fcSuccess.set('');
    this.fcBusy.set(true);
    this.api
      .unpairFlightController(this.droneId)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.fcBusy.set(false)),
      )
      .subscribe({
        next: () => {
          this.drone.update((current) => (current ? { ...current, activeFlightController: null } : current));
          this.fcForm.reset();
          this.fcSuccess.set('Đã hủy ghép nối Flight Controller.');
        },
        error: (err: unknown) => {
          this.fcError.set(describeHttpError(err, 'Không thể hủy ghép nối Flight Controller.'));
        },
      });
  }

  protected submitInspection(): void {
    if (!this.canEditBist()) return;
    this.bistError.set('');
    this.bistSuccess.set('');
    if (this.bistForm.invalid) {
      this.bistForm.markAllAsTouched();
      this.bistError.set('Vui lòng kiểm tra lại thông số kiểm định BIST trước khi lưu.');
      return;
    }

    const raw = this.bistForm.getRawValue();
    const metrics = this.buildInspectionMetrics();
    const missing = missingCodes(metrics);
    const payload: SubmitUavInspectionRequest = {
      sourceType: raw.sourceType,
      conclusion: raw.conclusion,
      notes: raw.notes.trim() || null,
      metrics: metrics.filter((metric) => metric.numericValue != null || metric.boolValue != null),
      // Backend lưu riêng các mã thiếu và đánh dấu biên bản chưa đạt.
      missingMetricCodes: missing,
    };
    this.submittingBist.set(true);
    this.api
      .submitUavInspection(this.droneId, payload)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.submittingBist.set(false)),
      )
      .subscribe({
        next: (saved) => {
          const nextHealth = saved.readiness === 'Ready' ? 'Healthy' : 'Critical';
          this.drone.update((current) => (current ? { ...current, technicalHealth: nextHealth } : current));
          this.history.update((items) => sortHistoryDesc([saved, ...items.filter((x) => x.id !== saved.id)]));
          this.reportedMissingMetrics.set([...missing, ...(saved.missingMetricCodes ?? [])]);
          this.bistSuccess.set(`Đã lưu kết quả kiểm định: ${droneReadinessLabel(saved.readiness)}.`);
        },
        error: (err: unknown) => {
          // Giữ nguyên dữ liệu form đang nhập để kỹ thuật viên sửa lại sau khi đọc thông báo lỗi.
          const { code, status } = readBackendError(err);
          if (code === 'METRICS_REQUIRED' || status === 0) this.reportedMissingMetrics.set(missing);
          this.bistError.set(describeHttpError(err, 'Không thể lưu biên bản kiểm định kỹ thuật.'));
        },
      });
  }

  protected formatDateTime(iso?: string | null): string {
    return formatVietnamDateTime(iso, 'Chưa ghi nhận');
  }

  protected operationalStatusText(status?: string | null): string {
    return status ? statusLabel(status) : 'Chưa cập nhật';
  }

  protected sourceLabel(source?: string | null): string {
    const key = (source ?? '').trim().toLowerCase();
    return SOURCE_LABELS[key] ?? 'Kiểm định kỹ thuật';
  }

  protected readinessLabelFor(record: UavInspectionRecord): string {
    return droneReadinessLabel(record.readiness);
  }

  private buildInspectionMetrics(): readonly UavInspectionMetricInput[] {
    const raw = this.bistForm.getRawValue();
    const readings = BIST_NUMERIC_FIELDS.map(({ field, code, subsystem, unit, minimum }) => {
      const numericValue = raw[field];
      return {
        metricCode: code, subsystem, unit, numericValue,
        passed: numericValue === null ? null : numericValue >= minimum,
        isRequired: true,
        critical: field === 'batteryPercent',
      };
    });
    const checks = BIST_CHECK_FIELDS.map(({ field, code, subsystem }) => ({
      metricCode: code, subsystem,
      boolValue: raw[field],
      passed: raw[field],
      isRequired: true,
    }));
    return [...readings, ...checks];
  }
}
