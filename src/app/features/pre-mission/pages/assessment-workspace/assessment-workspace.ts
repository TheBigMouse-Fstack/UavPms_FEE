
function resolveRegionCoordinates(regionName: string): { lat: number; lng: number } {
  const norm = (regionName || '').toLowerCase();
  if (norm.includes('an phú') || norm.includes('thủ đức')) return { lat: 10.8015, lng: 106.7455 };
  if (norm.includes('bình thạnh') || norm.includes('phường 25')) return { lat: 10.8012, lng: 106.7148 };
  if (norm.includes('linh trung')) return { lat: 10.8642, lng: 106.7765 };
  if (norm.includes('quận 1') || norm.includes('bến nghé')) return { lat: 10.7812, lng: 106.7005 };
  if (norm.includes('gò vấp')) return { lat: 10.8385, lng: 106.6657 };
  if (norm.includes('tân bình')) return { lat: 10.7981, lng: 106.6543 };
  return { lat: 10.7769, lng: 106.7009 };
}

import { DatePipe, DecimalPipe, Location } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Map as MapLibreMap, Marker } from 'maplibre-gl';
import { Subscription } from 'rxjs';
import { Auth } from '../../../../core/auth/auth';
import { ToastService } from '../../../../core/toast/toast.service';
import { isManagerRole, isTechnicianRole } from '../../../../core/auth/roles';
import {
  BetaflightSerialService,
} from '../../../../core/services/betaflight-serial.service';
import { FlightControllerResolveResult } from '../../../../models/flight-controller.models';
import {
  AssessmentTowerOption,
  DroneTechnicalInspectionResult,
  PersonnelCandidate,
  PreMissionAssessment,
  ReadinessCheck,
  SiteCheckItem,
  UavCandidate,
  UavTechnicalEligibility,
} from '../../../../models/pre-mission.models';
import { priorityColorClass, priorityLabel, statusColorClass, statusLabel, statusTone } from '../../../../shared/status/status';
import { NotificationsRealtime } from '../../../notifications/data-access/notifications-realtime';
import { FlightControllerApi } from '../../data-access/flight-controller-api';
import {
  needsTechnicianInspection,
  personnelReasonLabel,
  suitabilityLabel,
  technicalEligibilityLabel,
  technicalEligibilityTone,
  uavReasonLabel,
} from '../../data-access/candidate-labels';
import { buildInspectionChecklist } from '../../data-access/inspection-checklist';
import { PreMissionApi, RealtimeWeatherSnapshot, weatherSiteChecks } from '../../data-access/pre-mission-api';
import { describeHttpError, isStaleDataError } from '../../../../shared/errors/business-error-messages';
import {
  buildLocalGisStyle,
  createLocalGisMap,
  DEFAULT_LOCAL_MAP_CENTER,
  DEFAULT_LOCAL_MAP_ZOOM,
  filterValidCoordinates,
  fitLocalGisBounds,
  LocalMapMode,
  resolveLocalMapMode,
  setLocalGisRouteLine,
} from '../../../../shared/gis/local-gis';

const SVG_NS = 'http://www.w3.org/2000/svg';

export type WorkspaceTab = 'overview' | 'site' | 'personnel' | 'uav' | 'technical';

export interface ParsedPersonnelFindings {
  readonly isJson: boolean;
  readonly role?: string;
  readonly inScope: boolean;
  readonly isActive: boolean;
  readonly hasValidRole: boolean;
  readonly hasInspectorRole: boolean;
  readonly hasBookingConflict: boolean;
  readonly rawText?: string;
}

@Component({
  selector: 'app-assessment-workspace',
  imports: [RouterLink, DatePipe, DecimalPipe],
  templateUrl: './assessment-workspace.html',
  styleUrl: './assessment-workspace.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AssessmentWorkspace implements AfterViewInit, OnDestroy {
  private readonly api = inject(PreMissionApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(Auth);
  private readonly location = inject(Location);
  private readonly realtime = inject(NotificationsRealtime);
  private readonly fcSerial = inject(BetaflightSerialService);
  private readonly fcApi = inject(FlightControllerApi);
  private readonly toast = inject(ToastService);
  private realtimeSub: Subscription | null = null;

  /** Tọa độ thực của các cột thuộc khu vực (từ `GET /towers?regionId=`) để vẽ phạm vi lên bản đồ. */
  protected readonly regionTowers = signal<readonly AssessmentTowerOption[]>([]);

  protected readonly scopeMapContainer = viewChild<ElementRef<HTMLDivElement>>('scopeMapContainer');
  protected readonly siteMapContainer = viewChild<ElementRef<HTMLDivElement>>('siteMapContainer');

  protected readonly currentUser = this.auth.user;
  /** Re-evaluate, cancel and create mission (MF02): SystemAdmin/Manager. */
  protected readonly canManage = computed(() => isManagerRole(this.currentUser()?.role));
  /** Technicians open the workspace for the drone technical inspection (MF01) only. */
  protected readonly isTechnician = computed(() => isTechnicianRole(this.currentUser()?.role));
  /**
   * `POST /drone-technical-inspections`, `POST /drones/{id}/flight-controller`: MaintenanceTechnician, Technician,
   * Manager, SystemAdmin. Inspectors get 403, so they only read the results.
   */
  protected readonly canInspectDrone = computed(() => this.canManage() || this.isTechnician());

  protected readonly item = signal<PreMissionAssessment | null>(null);
  protected readonly statusColorClass = statusColorClass;
  protected readonly priorityLabel = priorityLabel;
  protected readonly priorityColorClass = priorityColorClass;

  protected roleVietnamese(role?: string | null): string {
    const r = (role || '').trim().toUpperCase();
    if (r.includes('INSPECT') || r.includes('PILOT')) return 'Phi công';
    if (r.includes('ANALYST')) return 'Chuyên viên phân tích';
    if (r.includes('TECH') || r.includes('MAINT')) return 'Kỹ thuật viên';
    return role || '—';
  }

  protected formatCandidateName(name?: string | null): string {
    const raw = (name || '').trim();
    if (!raw) return '—';
    // Shorten raw GUID fallback from backend for readability (full value stays in title tooltip)
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) {
      return `ID ${raw.slice(0, 8).toUpperCase()}`;
    }
    return raw;
  }

  protected severityVietnamese(sev?: string | null): string {
    const s = (sev || '').trim().toLowerCase();
    if (s === 'high' || s === 'critical') return 'Cao';
    if (s === 'medium' || s === 'warning') return 'Trung bình';
    if (s === 'low' || s === 'info') return 'Thấp';
    return sev || '—';
  }

  protected severityColorClass(sev?: string | null): string {
    const s = (sev || '').trim().toLowerCase();
    if (s === 'high' || s === 'critical') return 'text-rose-600 font-medium';
    if (s === 'medium' || s === 'warning') return 'text-amber-700 font-medium';
    return 'text-slate-600 font-medium';
  }

  protected technicalColorClass(elig?: UavTechnicalEligibility): string {
    if (elig === 'ELIGIBLE') return 'text-emerald-600 font-medium';
    if (elig === 'CRITICAL') return 'text-rose-600 font-medium';
    if (elig === 'REQUIRES_INSPECTION' || elig === 'DEGRADED') return 'text-amber-700 font-medium';
    return 'text-slate-600 font-medium';
  }

  protected suitabilityColorClass(suit?: string | null): string {
    if (suit === 'SUITABLE') return 'text-emerald-600 font-medium';
    if (suit === 'SUITABLE_WITH_SPLIT') return 'text-amber-700 font-medium';
    if (suit === 'UNSUITABLE') return 'text-rose-600 font-medium';
    return 'text-slate-600 font-medium';
  }

  protected findingsSummaryList(f: ParsedPersonnelFindings, role: string): readonly { text: string; ok: boolean }[] {
    if (!f.isJson) {
      return [{ text: f.rawText || 'Đạt tiêu chuẩn sẵn sàng vận hành', ok: true }];
    }
    const items: { text: string; ok: boolean }[] = [];
    if (f.hasInspectorRole || role === 'INSPECTOR') {
      items.push({ text: 'Chứng chỉ bay UAV', ok: true });
    } else if (role === 'TECHNICIAN' || f.role === 'Technician' || f.role === 'MaintenanceTechnician') {
      items.push({ text: 'KTV bảo trì UAV', ok: true });
    } else if (role === 'ANALYST' || f.role === 'Analyst') {
      items.push({ text: 'CV phân tích AI', ok: true });
    }
    if (!f.hasValidRole) items.push({ text: 'Thiếu chuẩn vai trò', ok: false });
    items.push({ text: f.inScope ? 'Đúng địa bàn' : 'Khác địa bàn', ok: f.inScope });
    items.push({ text: f.isActive ? 'Hồ sơ hợp lệ' : 'Chưa kích hoạt', ok: f.isActive });
    if (f.hasBookingConflict) items.push({ text: 'Trùng lịch bay', ok: false });
    return items;
  }
  protected readonly error = signal('');
  protected readonly actionMessage = signal('');
  protected readonly isStaleConflict = signal(false);
  protected readonly busy = signal(false);
  protected readonly activeTab = signal<WorkspaceTab>(isTechnicianRole(this.auth.user()?.role) ? 'technical' : 'overview');

  // Bộ lọc ứng viên nhân sự
  protected readonly personnelSearch = signal('');
  protected readonly selectedRoleFilter = signal<'ALL' | 'INSPECTOR' | 'ANALYST' | 'TECHNICIAN'>('ALL');
  protected readonly onlyAvailableFilter = signal<boolean>(false);

  // Kiểm định kỹ thuật drone
  protected readonly selectedDroneId = signal<string>('');
  protected readonly inspectionResult = signal<DroneTechnicalInspectionResult | null>(null);
  protected readonly inspecting = signal(false);

  // Flight Controller (Betaflight MSP)
  protected readonly fcMetadata = this.fcSerial.activeMetadata;
  protected readonly fcConnectionState = this.fcSerial.connectionState;
  protected readonly fcError = this.fcSerial.errorMessage;
  protected readonly customFcUidInput = signal<string>('');
  protected readonly showCustomUidInput = signal<boolean>(false);
  protected readonly resolvingFc = signal<boolean>(false);
  protected readonly resolvedFcData = signal<FlightControllerResolveResult | null>(null);
  protected readonly pairingFc = signal<boolean>(false);
  protected readonly pairingError = signal<string>('');
  protected readonly pairingSuccess = signal<string>('');
  protected readonly pairTargetDroneId = signal<string>('');

  // Technical inspection checklist modal state
  protected readonly showChecklistModal = signal<boolean>(false);
  protected readonly checklistSubmitting = signal<boolean>(false);
  protected readonly inspectionPreset = signal<'healthy' | 'warning' | 'critical'>('healthy');
  protected readonly checklistBatteryLevel = signal<number>(96);
  protected readonly checklistGpsSats = signal<number>(28);
  protected readonly checklistRfQuality = signal<number>(98);
  protected readonly checklistNotes = signal<string>('Biên bản kiểm định kỹ thuật thiết bị UAV trước nhiệm vụ');

  // Khí tượng (tham khảo, không thay đổi kết quả đánh giá của backend)
  protected readonly realtimeWeather = signal<RealtimeWeatherSnapshot | null>(null);
  protected readonly loadingWeather = signal(false);
  protected readonly siteChecks = computed<readonly SiteCheckItem[]>(() => {
    const w = this.realtimeWeather();
    return w ? weatherSiteChecks(w) : [];
  });

  protected readonly currentAssessmentDrone = computed(() => {
    const a = this.item();
    const selId = this.selectedDroneId();
    if (!a || !a.uavCandidates.length) return null;
    return a.uavCandidates.find((d) => d.id === selId) || a.uavCandidates[0];
  });

  protected readonly isFcConnected = computed(() => this.fcConnectionState() === 'connected' && !!this.fcMetadata());
  protected readonly isFcRegistered = computed(() => this.isFcConnected() && this.resolvedFcData()?.registered === true);
  protected readonly isFcUnregistered = computed(() => this.isFcConnected() && this.resolvedFcData()?.registered === false);
  protected readonly fcDrone = computed(() => this.resolvedFcData()?.drone ?? null);

  protected readonly isFcMatchingAssessmentDrone = computed(() => {
    if (!this.isFcConnected()) return false;
    const res = this.resolvedFcData();
    const target = this.currentAssessmentDrone();
    if (!res || !res.registered || !res.drone || !target) return false;
    return (
      (!!res.drone.id && res.drone.id.toLowerCase() === target.id.toLowerCase()) ||
      (!!res.drone.code && res.drone.code.toUpperCase() === target.code.toUpperCase())
    );
  });

  protected readonly isFcDroneMismatch = computed(() => {
    if (!this.isFcConnected()) return false;
    const res = this.resolvedFcData();
    if (!res || !res.registered || !res.drone || !this.currentAssessmentDrone()) return false;
    return !this.isFcMatchingAssessmentDrone();
  });

  // Bản đồ nội bộ (MapLibre + PMTiles / schematic fallback)
  private map: MapLibreMap | null = null;
  private markers: Marker[] = [];
  private routeCoords: [number, number][] = [];
  private appliedMapMode: LocalMapMode = 'pmtiles';
  private resizeObserver: ResizeObserver | null = null;
  private mapInitTimer: ReturnType<typeof setTimeout> | null = null;
  protected readonly currentMapType = signal<LocalMapMode>('pmtiles');

  protected readonly status = computed(() => (this.item()?.status ?? '').toUpperCase());
  protected readonly isReady = computed(() => this.status() === 'READY');
  protected readonly isEvaluating = computed(() => this.status() === 'EVALUATING');
  protected readonly isCancelled = computed(() => this.status() === 'CANCELLED');
  protected readonly isCompleted = computed(() => this.status() === 'COMPLETED' || !!this.item()?.completedMissionId);
  protected readonly isExpired = computed(() => {
    const a = this.item();
    if (!a) return false;
    if (this.status() === 'EXPIRED') return true;
    return !!a.validUntil && new Date(a.validUntil).getTime() < Date.now();
  });

  /** Cấu hình định mức nhân sự và giới hạn UAV được thiết lập từ hồ sơ (FindingsJson). */
  protected readonly assessmentConfig = computed(() => {
    const raw = this.item()?.findings;
    let reqInspectors = 1;
    let reqAnalysts = 1;
    let reqTechnicians = 1;
    let maxDronesLimit = 1;
    if (raw) {
      try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (typeof parsed?.requiredInspectors === 'number') reqInspectors = Math.max(1, parsed.requiredInspectors);
        if (typeof parsed?.requiredAnalysts === 'number') reqAnalysts = Math.max(1, parsed.requiredAnalysts);
        if (typeof parsed?.requiredTechnicians === 'number') reqTechnicians = Math.max(1, parsed.requiredTechnicians);
        if (typeof parsed?.maxDronesLimit === 'number') maxDronesLimit = Math.max(1, parsed.maxDronesLimit);
      } catch {
        // Ignore malformed findings JSON
      }
    }
    return { reqInspectors, reqAnalysts, reqTechnicians, maxDronesLimit };
  });

  /** Thống kê ứng viên đủ điều kiện theo vai trò (đúng quy tắc của backend). */
  protected readonly roleBreakdown = computed(() => {
    const candidates = this.item()?.personnelCandidates ?? [];
    const eligible = candidates.filter((c) => c.isEligible);
    const inspectors = eligible.filter((c) => c.role === 'INSPECTOR');
    const analysts = eligible.filter((c) => c.role === 'ANALYST');
    const technicians = eligible.filter((c) => c.role === 'TECHNICIAN');

    const cfg = this.assessmentConfig();
    const missingDetails: string[] = [];
    const missingRoles: string[] = [];
    const check = (label: string, count: number, required: number) => {
      if (count < required) {
        missingDetails.push(`${label}: thiếu ${required - count} người đủ điều kiện`);
        missingRoles.push(`${label} (${count}/${required})`);
      }
    };
    check('Phi công', inspectors.length, cfg.reqInspectors);
    check('Chuyên viên phân tích', analysts.length, cfg.reqAnalysts);
    check('Kỹ thuật viên', technicians.length, cfg.reqTechnicians);

    return {
      inspectors,
      analysts,
      technicians,
      allAvailable: eligible,
      reqInspectors: cfg.reqInspectors,
      reqAnalysts: cfg.reqAnalysts,
      reqTechnicians: cfg.reqTechnicians,
      hasAllThree: missingDetails.length === 0,
      missingDetails,
      missingRoles,
      totalEligible: inspectors.length + analysts.length + technicians.length,
      totalRequired: cfg.reqInspectors + cfg.reqAnalysts + cfg.reqTechnicians,
    };
  });

  /** Chỉ hồ sơ READY, còn hiệu lực và chưa dùng mới được tạo nhiệm vụ (`POST /{id}/create-mission`). */
  protected readonly canProceedToMf02 = computed(
    () => this.canManage() && this.isReady() && !this.isExpired() && !this.isCompleted() && !this.isCancelled(),
  );

  protected readonly failedConditions = computed(() => {
    const a = this.item();
    if (!a) return [];
    const list: { pillar: string; reason: string; actionTab: WorkspaceTab; actionLabel: string }[] = [];

    if (a.site.status !== 'PASS') {
      list.push({
        pillar: 'Mặt bằng',
        reason: a.site.reason || 'Mặt bằng hành lang chưa đạt điều kiện an toàn.',
        actionTab: 'site',
        actionLabel: 'Xem chi tiết mặt bằng',
      });
    }
    if (a.personnel.status !== 'PASS') {
      const roles = this.roleBreakdown();
      list.push({
        pillar: 'Nhân sự vận hành',
        reason: roles.missingDetails.length
          ? `${roles.missingDetails.join('; ')}.`
          : a.personnel.reason || 'Chưa đạt định mức nhân sự đang rảnh.',
        actionTab: 'personnel',
        actionLabel: 'Xem ứng viên nhân sự',
      });
    }
    if (a.uav.status !== 'PASS') {
      list.push({
        pillar: 'Phương tiện UAV',
        reason: a.uav.reason || 'Chưa có UAV nào đạt hạn kiểm định hoặc khả dụng trong khung giờ này.',
        actionTab: 'uav',
        actionLabel: 'Xem danh sách thiết bị bay',
      });
    }
    if (a.technical.status !== 'PASS') {
      list.push({
        pillar: 'Sức khỏe kỹ thuật',
        reason: a.technical.reason || 'Cần thực hiện kiểm định kỹ thuật trước khi bay.',
        actionTab: 'technical',
        actionLabel: 'Chạy kiểm định kỹ thuật',
      });
    }
    return list;
  });

  protected formatManagerName(managerId?: string | null): string {
    if (!managerId) return 'Quản lý vận hành';
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(managerId.trim())) {
      const u = this.auth.user();
      if (u && (u.id === managerId || u.email === managerId)) {
        return u.fullName || u.email || 'Quản lý vận hành';
      }
      return 'Quản lý vận hành';
    }
    return managerId;
  }

  protected readonly filteredPersonnel = computed(() => {
    let list: readonly PersonnelCandidate[] = this.item()?.personnelCandidates ?? [];

    if (this.onlyAvailableFilter()) {
      list = list.filter((p) => p.availabilityStatus === 'Available' && p.isEligible);
    }
    const roleFilter = this.selectedRoleFilter();
    if (roleFilter !== 'ALL') {
      list = list.filter((p) => p.role === roleFilter);
    }
    const q = this.personnelSearch().trim().toLowerCase();
    if (q) {
      list = list.filter(
        (p) => p.name.toLowerCase().includes(q) || p.rawRole.toLowerCase().includes(q) || p.findings.toLowerCase().includes(q),
      );
    }

    // Mặc định đẩy người đủ điều kiện & sẵn sàng lên đầu danh sách
    return [...list].sort((a, b) => {
      const aEligible = a.isEligible ? 1 : 0;
      const bEligible = b.isEligible ? 1 : 0;
      if (aEligible !== bEligible) return bEligible - aEligible;

      const aAvail = a.availabilityStatus === 'Available' ? 1 : 0;
      const bAvail = b.availabilityStatus === 'Available' ? 1 : 0;
      if (aAvail !== bAvail) return bAvail - aAvail;

      const aEligStatus = (a.eligibilityStatus || '').toUpperCase() === 'ELIGIBLE' ? 1 : 0;
      const bEligStatus = (b.eligibilityStatus || '').toUpperCase() === 'ELIGIBLE' ? 1 : 0;
      if (aEligStatus !== bEligStatus) return bEligStatus - aEligStatus;

      return (a.name || '').localeCompare(b.name || '', 'vi');
    });
  });

  /** Cột trong phạm vi hồ sơ kèm tọa độ (nếu có trong danh mục cột của khu vực), sắp đúng thứ tự tuyến bay. */
  protected readonly scopeTowers = computed(() => {
    const a = this.item();
    if (!a) return [];
    const byId = new Map(this.regionTowers().map((t) => [t.id, t]));
    return [...a.towers]
      .sort((x, y) => (x.sequence ?? 0) - (y.sequence ?? 0))
      .map((t) => {
        const info = byId.get(t.towerId);
        return {
          towerId: t.towerId,
          sequence: t.sequence,
          towerCode: t.towerCode || info?.towerCode || t.towerId,
          latitude: info?.latitude ?? null,
          longitude: info?.longitude ?? null,
        };
      });
  });

  protected readonly statusTone = statusTone;
  protected readonly statusLabel = statusLabel;

  // MF01 candidate reasons: `suitability` only describes scope; availability/technical come from separate fields.
  protected readonly uavReason = uavReasonLabel;
  protected readonly personnelReason = personnelReasonLabel;

  protected parseFindings(findings: string | undefined | null, operationalRole?: string): ParsedPersonnelFindings {
    if (!findings || !findings.trim()) {
      return {
        isJson: false,
        inScope: true,
        isActive: true,
        hasValidRole: true,
        hasInspectorRole: operationalRole === 'INSPECTOR',
        hasBookingConflict: false,
        rawText: 'Đạt chuẩn vai trò và căn cứ sẵn sàng',
      };
    }

    const trimmed = findings.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const obj = JSON.parse(trimmed) as Record<string, unknown>;
        return {
          isJson: true,
          role: typeof obj['role'] === 'string' ? obj['role'] : undefined,
          inScope: obj['inScope'] !== false,
          isActive: obj['isActive'] !== false,
          hasValidRole: obj['hasValidRole'] !== false,
          hasInspectorRole: obj['hasInspectorRole'] === true || operationalRole === 'INSPECTOR',
          hasBookingConflict: obj['hasBookingConflict'] === true,
          rawText: trimmed,
        };
      } catch {
        // Fall back to plain text
      }
    }

    return {
      isJson: false,
      inScope: true,
      isActive: true,
      hasValidRole: true,
      hasInspectorRole: operationalRole === 'INSPECTOR',
      hasBookingConflict: false,
      rawText: trimmed,
    };
  }
  protected readonly technicalLabel = technicalEligibilityLabel;
  protected readonly technicalTone = technicalEligibilityTone;
  protected readonly suitabilityText = suitabilityLabel;
  protected readonly needsInspection = needsTechnicianInspection;
  protected readonly eligibleUavCount = computed(() => (this.item()?.uavCandidates ?? []).filter((d) => d.isEligible).length);
  /** UAVs that a technician must inspect (no inspection valid at the planned start, failed or degraded). */
  protected readonly uavNeedingInspectionCount = computed(
    () => (this.item()?.uavCandidates ?? []).filter((d) => needsTechnicianInspection(d)).length,
  );
  /** The checklist modal opened from "Chạy kiểm định" (real readings) rather than the BIST simulator. */
  protected readonly checklistManual = signal(false);

  protected readonly showCancelModal = signal<boolean>(false);
  protected readonly cancelReason = signal<string>('');

  constructor() {
    this.load();
    this.initRealtimeSubscription();

    effect(() => {
      const msg = this.actionMessage();
      if (msg) {
        this.toast.success(msg);
        untracked(() => this.actionMessage.set(''));
      }
    });

    effect(() => {
      const err = this.error();
      if (err && this.item()) {
        this.toast.error(err);
        untracked(() => this.error.set(''));
      }
    });

    effect(() => {
      const a = this.item();
      const tab = this.activeTab();
      const scopeEl = this.scopeMapContainer();
      this.regionTowers();
      if (a && tab === 'overview' && scopeEl) {
        this.scheduleMapUpdate(60);
      } else if (tab !== 'overview') {
        this.cleanupMap();
      }
    });
  }

  ngAfterViewInit(): void {
    if (this.activeTab() === 'overview') {
      this.scheduleMapUpdate(150);
    }
  }

  ngOnDestroy(): void {
    const a = this.item();
    if (a?.id) this.realtime.leaveAssessment(a.id);
    this.realtimeSub?.unsubscribe();
    this.cleanupMap();
    this.fcSerial.disconnect().catch(() => undefined);
  }

  private initRealtimeSubscription(): void {
    this.realtimeSub = this.realtime.assessmentEvents$.subscribe((evt) => {
      const current = this.item();
      if (!current || (evt.assessmentId && evt.assessmentId !== current.id)) return;

      switch (evt.type) {
        case 'DroneInspectionCompleted': {
          if (evt.droneId) {
            this.loadLatestInspection(evt.droneId);
          }
          if (this.canManage()) {
            this.api.reEvaluate(current.id).subscribe({
              next: (updated) => {
                this.item.set(updated);
                if (evt.message) this.actionMessage.set(evt.message);
              },
            });
          }
          break;
        }
        case 'AssessmentStatusChanged':
        case 'AssessmentCompleted': {
          // Luôn tải lại hồ sơ từ backend để hiển thị kết quả chính thức.
          this.api.get(current.id).subscribe({
            next: (updated) => {
              this.item.set(updated);
              if (evt.message) this.actionMessage.set(evt.message);
            },
          });
          break;
        }
      }
    });
  }

  protected load(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.error.set('Không tìm thấy mã định danh đánh giá.');
      return;
    }
    this.busy.set(true);
    this.isStaleConflict.set(false);
    this.error.set('');
    this.api.get(id).subscribe({
      next: (res) => {
        this.item.set(res);
        this.realtime.joinAssessment(res.id);
        if (res.uavCandidates.length > 0 && !this.selectedDroneId()) {
          this.selectedDroneId.set(res.uavCandidates[0].id);
        }
        // Technicians land on the technical tab: show the latest inspection of the selected drone right away.
        const droneId = this.selectedDroneId();
        if (this.activeTab() === 'technical' && droneId && !this.inspectionResult()) this.loadLatestInspection(droneId);
        this.loadRegionTowers(res);
        this.busy.set(false);
      },
      error: () => {
        this.busy.set(false);
        this.error.set('Đánh giá tiền nhiệm vụ không tồn tại hoặc bạn không có quyền truy cập.');
      },
    });
  }

  /** Mở trang tạo hồ sơ mới với phạm vi sao chép từ hồ sơ hiện tại (dùng khi hồ sơ hết hạn). */
  protected goBack(): void {
    const id = this.item()?.id || this.route.snapshot.paramMap.get('id');
    if (id) {
      void this.router.navigate(['/pre-mission/new'], { queryParams: { assessmentId: id } });
    } else if (window.history.length > 1) {
      this.location.back();
    } else {
      void this.router.navigate(['/pre-mission']);
    }
  }

  private loadRegionTowers(a: PreMissionAssessment): void {
    if (!a.regionId) return;
    this.api.getRegionTowers(a.regionId).subscribe({
      next: (towers) => {
        this.regionTowers.set(towers);
        this.loadWeather();
      },
      error: () => this.regionTowers.set([]),
    });
  }

  private loadWeather(): void {
    const a = this.item();
    const regionName = a?.regionName || 'Khu vực quản lý lưới điện';
    const first = this.scopeTowers().find((t) => t.latitude != null && t.longitude != null);

    let lat = first?.latitude ?? null;
    let lng = first?.longitude ?? null;
    const towerCode = first?.towerCode;

    if (lat == null || lng == null) {
      const coords = resolveRegionCoordinates(regionName);
      lat = coords.lat;
      lng = coords.lng;
    }

    this.loadingWeather.set(true);
    this.api.getRealtimeWeather(lat, lng, regionName, towerCode).subscribe({
      next: (weather) => {
        this.realtimeWeather.set(weather);
        this.loadingWeather.set(false);
      },
      error: () => this.loadingWeather.set(false),
    });
  }

  protected reevaluate(): void {
    const a = this.item();
    if (!a || this.busy()) return;
    this.busy.set(true);
    this.actionMessage.set('');
    this.error.set('');
    this.isStaleConflict.set(false);

    this.api.reEvaluate(a.id).subscribe({
      next: (updated) => {
        this.item.set(updated);
        this.busy.set(false);
        this.actionMessage.set('Đã hoàn tất đánh giá lại tính khả thi và nguồn lực.');
        this.realtime.broadcastAssessmentEvent({
          assessmentId: updated.id,
          type: 'AssessmentStatusChanged',
          status: updated.status,
          message: `Hồ sơ đã được đánh giá lại: ${updated.status}`,
          timestamp: new Date().toISOString(),
        });
      },
      error: (err: unknown) => {
        this.busy.set(false);
        if (isStaleDataError(err)) {
          this.isStaleConflict.set(true);
          this.error.set('Dữ liệu đánh giá đã bị thay đổi bởi phiên làm việc khác. Vui lòng bấm "Làm mới dữ liệu".');
        } else {
          this.error.set(describeHttpError(err, 'Không thể thực hiện đánh giá lại. Vui lòng thử lại sau.'));
        }
      },
    });
  }

  protected openCancelModal(): void {
    if (!this.item() || this.busy()) return;
    if (this.isCompleted()) {
      this.error.set('Không thể hủy đánh giá đã hoàn thành / tạo nhiệm vụ.');
      return;
    }
    if (this.isCancelled()) {
      this.error.set('Hồ sơ đánh giá đã bị hủy trước đó.');
      return;
    }
    if (this.isExpired()) {
      this.error.set('Hồ sơ đánh giá đã hết hạn, không thể hủy. Vui lòng lập hồ sơ mới nếu cần.');
      return;
    }
    this.cancelReason.set('');
    this.showCancelModal.set(true);
  }

  /** Reloads the assessment quietly (after an action failed because its state changed on the server). */
  private refreshItem(id: string): void {
    this.api.get(id).subscribe({ next: (updated) => this.item.set(updated), error: () => undefined });
  }

  protected closeCancelModal(): void {
    if (this.busy()) return;
    this.showCancelModal.set(false);
  }

  protected executeCancel(): void {
    const a = this.item();
    if (!a || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    this.isStaleConflict.set(false);
    const reason = this.cancelReason().trim() || 'Người dùng hủy tại trang chi tiết';

    this.api.cancel(a.id, reason).subscribe({
      next: (updated) => {
        this.item.set(updated);
        this.busy.set(false);
        this.showCancelModal.set(false);
        this.actionMessage.set(`Đã hủy bản đánh giá ${a.assessmentCode}.`);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        if (isStaleDataError(err)) {
          this.isStaleConflict.set(true);
          this.error.set('Dữ liệu đánh giá đã bị thay đổi bởi phiên làm việc khác. Vui lòng bấm "Làm mới dữ liệu".');
        } else {
          // ASSESSMENT_CANCELLED / ASSESSMENT_EXPIRED / ASSESSMENT_ALREADY_COMPLETED are final: reload to show the state.
          this.error.set(describeHttpError(err, 'Không thể hủy bản đánh giá.'));
          this.showCancelModal.set(false);
          this.refreshItem(a.id);
        }
      },
    });
  }

  protected setTab(tab: WorkspaceTab): void {
    this.activeTab.set(tab);
    if (tab === 'overview' || tab === 'site') {
      setTimeout(() => this.initOrUpdateMap(), 150);
      return;
    }
    this.cleanupMap();
    if (tab === 'technical') {
      const droneId = this.selectedDroneId();
      if (droneId && !this.inspectionResult()) this.loadLatestInspection(droneId);
    }
  }

  protected selectDroneForInspection(drone: UavCandidate): void {
    this.selectedDroneId.set(drone.id);
    this.inspectionResult.set(null);
    this.setTab('technical');
    this.loadLatestInspection(drone.id);
  }

  protected loadLatestInspection(droneId: string): void {
    this.inspecting.set(true);
    this.api.getLatestTechnicalInspection(droneId).subscribe({
      next: (res) => {
        this.inspectionResult.set(res);
        this.inspecting.set(false);
        this.applyInspectionResultToAssessment(res);
      },
      error: () => {
        this.inspectionResult.set(null);
        this.inspecting.set(false);
      },
    });
  }

  protected async connectRealFc(): Promise<void> {
    this.pairingError.set('');
    this.pairingSuccess.set('');
    this.resolvedFcData.set(null);
    try {
      const meta = await this.fcSerial.connectRealSerial();
      this.resolveFc(meta.uid);
    } catch {
      // Lỗi đã được ghi vào signal của BetaflightSerialService.
    }
  }

  protected async disconnectFc(): Promise<void> {
    await this.fcSerial.disconnect();
    this.resolvedFcData.set(null);
    this.pairingError.set('');
    this.pairingSuccess.set('');
  }

  protected resolveFc(uid: string): void {
    if (!uid) return;
    this.resolvingFc.set(true);
    this.pairingError.set('');

    this.fcApi.resolveDrone(uid).subscribe({
      next: (res) => {
        this.resolvedFcData.set(res);
        this.resolvingFc.set(false);
        const current = this.currentAssessmentDrone();
        if (current) this.pairTargetDroneId.set(current.id);
      },
      error: (err: unknown) => {
        this.resolvingFc.set(false);
        if (err instanceof HttpErrorResponse && err.status === 404) {
          this.resolvedFcData.set({ registered: false, flightControllerUid: uid, drone: null, binding: null });
        } else {
          this.pairingError.set(describeHttpError(err, 'Không thể tra cứu thông tin Flight Controller từ máy chủ.'));
        }
      },
    });
  }

  protected pairFcToDrone(): void {
    const meta = this.fcMetadata();
    if (!meta || !meta.uid) {
      this.pairingError.set('Chưa có thông tin Flight Controller kết nối.');
      return;
    }
    const targetDroneId = this.pairTargetDroneId() || this.currentAssessmentDrone()?.id;
    if (!targetDroneId) {
      this.pairingError.set('Vui lòng chọn UAV để ghép nối.');
      return;
    }

    this.pairingFc.set(true);
    this.pairingError.set('');
    this.pairingSuccess.set('');

    this.fcApi
      .pairFlightController(targetDroneId, {
        flightControllerUid: meta.uid,
        boardIdentifier: meta.boardIdentifier,
        firmwareName: meta.firmwareName,
        firmwareVersion: meta.firmwareVersion,
      })
      .subscribe({
        next: () => {
          this.pairingFc.set(false);
          this.pairingSuccess.set(`Đã ghép nối thành công Flight Controller [${meta.uid}] với drone.`);
          this.resolveFc(meta.uid);
        },
        error: (err: unknown) => {
          this.pairingFc.set(false);
          this.pairingError.set(describeHttpError(err, 'Lỗi khi thực hiện ghép nối Flight Controller.'));
        },
      });
  }

  protected runInspectionNow(): void {
    const drone = this.currentAssessmentDrone();
    const droneId = drone?.id || this.selectedDroneId();
    if (!droneId) {
      this.error.set('Hồ sơ chưa có drone ứng viên để kiểm định.');
      return;
    }

    // BR-05: chặn gửi biên bản khi Flight Controller đang kết nối không thuộc drone được kiểm định.
    if (this.isFcConnected()) {
      if (this.isFcDroneMismatch()) {
        this.error.set(
          `CẢNH BÁO LỆCH THIẾT BỊ (BR-05): Flight Controller kết nối thuộc về ${this.fcDrone()?.code || 'drone khác'}, nhưng hồ sơ yêu cầu ${drone?.code || droneId}.`,
        );
        return;
      }
      if (this.isFcUnregistered()) {
        this.error.set('Flight Controller chưa được đăng ký trong hệ thống. Vui lòng ghép nối trước khi gửi biên bản kiểm định.');
        return;
      }
    }

    // The backend no longer accepts an inspection without readings (`METRICS_REQUIRED`) and fails every critical
    // item that has none, so the technician records the checklist first; the modal submits it with the FC UID.
    this.error.set('');
    this.checklistManual.set(true);
    this.showChecklistModal.set(true);
  }

  protected onSelectDrone(droneId: string): void {
    this.selectedDroneId.set(droneId);
    this.inspectionResult.set(null);
    this.loadLatestInspection(droneId);
  }

  protected closeChecklistModal(): void {
    if (this.checklistSubmitting()) return;
    this.showChecklistModal.set(false);
  }

  protected applyInspectionPreset(preset: 'healthy' | 'warning' | 'critical'): void {
    this.inspectionPreset.set(preset);
    if (preset === 'healthy') {
      this.checklistBatteryLevel.set(96);
      this.checklistGpsSats.set(28);
      this.checklistRfQuality.set(98);
      this.checklistNotes.set('Biên bản kiểm định kỹ thuật thiết bị UAV trước nhiệm vụ');
    } else if (preset === 'warning') {
      this.checklistBatteryLevel.set(68);
      this.checklistGpsSats.set(14);
      this.checklistRfQuality.set(82);
      this.checklistNotes.set('Cảnh báo mức pin 68% cận ngưỡng và tín hiệu vệ tinh mức trung bình');
    } else {
      this.checklistBatteryLevel.set(28);
      this.checklistGpsSats.set(4);
      this.checklistRfQuality.set(45);
      this.checklistNotes.set('Cảnh báo lỗi cảm biến IMU, mất liên kết RTK và pin dưới ngưỡng an toàn');
    }
  }

  /** Cập nhật tức thời kết quả kiểm định kỹ thuật vào hồ sơ hiển thị (realtime phản ánh số lượng đủ điều kiện). */
  protected applyInspectionResultToAssessment(res: DroneTechnicalInspectionResult): void {
    this.item.update((current) => {
      if (!current) return current;

      const statusLower = (res.status || '').toLowerCase();
      const healthUpper = (res.overallHealth || '').toUpperCase();
      const isPassed = res.eligibility === 'ELIGIBLE' && statusLower === 'passed';
      const isCritical = healthUpper === 'CRITICAL' || statusLower === 'failed';

      const updatedCandidates: readonly UavCandidate[] = current.uavCandidates.map((c) => {
        if (c.id.toLowerCase() === res.droneId.toLowerCase()) {
          const techEligibility: UavTechnicalEligibility = isPassed
            ? 'ELIGIBLE'
            : isCritical
              ? 'CRITICAL'
              : 'REQUIRES_INSPECTION';
          const isEligible = isPassed && c.isAvailable !== false && c.suitability !== 'UNSUITABLE';
          const reasonCode = isPassed
            ? (c.isAvailable === false ? c.reasonCode : null)
            : isCritical
              ? 'TECHNICAL_HEALTH_CRITICAL'
              : 'NO_VALID_TECHNICAL_INSPECTION';

          return {
            ...c,
            technicalHealth: res.overallHealth,
            technicalInspectionId: res.id,
            technicalEligibility: techEligibility,
            isEligible,
            reasonCode,
          };
        }
        return c;
      });

      const eligibleCount = updatedCandidates.filter((d) => d.isEligible).length;

      const uavCheck: ReadinessCheck = {
        ...current.uav,
        status: eligibleCount > 0 ? 'PASS' : 'FAIL',
        reason: eligibleCount > 0
          ? null
          : 'Chưa có UAV nào đạt hạn kiểm định hoặc khả dụng trong khung giờ này.',
        evaluatedAt: new Date().toISOString(),
      };

      const eligibleDrones = updatedCandidates.filter((d) => d.isEligible);
      const eligibleHealths = eligibleDrones.map((d) => (d.technicalHealth || '').toUpperCase());
      const overallTech = eligibleHealths.includes('HEALTHY')
        ? 'Healthy'
        : eligibleHealths.includes('WARNING')
          ? 'Warning'
          : eligibleCount === 0 || isCritical
            ? (healthUpper === 'CRITICAL' ? 'Critical' : 'Unknown')
            : 'Healthy';

      const isTechPass = (overallTech === 'Healthy' || overallTech === 'Warning') && eligibleCount > 0;
      const techCheck: ReadinessCheck = {
        ...current.technical,
        status: isTechPass ? 'PASS' : 'FAIL',
        reason: isTechPass
          ? null
          : (isCritical
              ? 'Phát hiện hỏng hóc kỹ thuật nghiêm trọng (Critical). Cần khắc phục trước khi bay.'
              : 'Cần thực hiện kiểm định kỹ thuật tự động (BIST/Telemetry) trước khi bay.'),
        evaluatedAt: new Date().toISOString(),
      };

      const isSitePass = current.site.status === 'PASS' || current.site.status === 'FEASIBLE';
      const hasAllRoles = this.roleBreakdown().hasAllThree;
      const isReady = isSitePass && hasAllRoles && eligibleCount > 0 && isTechPass;

      return {
        ...current,
        uavCandidates: updatedCandidates,
        uav: uavCheck,
        technical: techCheck,
        overallTechnicalHealth: overallTech,
        status: isReady ? 'READY' : 'NOT_READY',
      };
    });
  }

  /**
   * Submits the checklist from the modal (or a BIST preset) as a technical inspection. The payload always has
   * readings for every critical item; the `droneId` in the body is the inspected UAV.
   */
  protected submitInspectionChecklist(preset?: 'healthy' | 'warning' | 'critical'): void {
    if (preset) {
      this.applyInspectionPreset(preset);
      this.checklistManual.set(false);
    }

    const drone = this.currentAssessmentDrone();
    const droneId = drone?.id || this.selectedDroneId();
    if (!droneId) {
      this.error.set('Hồ sơ chưa có UAV ứng viên để thực hiện kiểm định kỹ thuật.');
      return;
    }
    if (this.isFcConnected() && (this.isFcDroneMismatch() || this.isFcUnregistered())) {
      this.error.set(
        this.isFcUnregistered()
          ? 'Flight Controller chưa được đăng ký trong hệ thống. Vui lòng ghép nối trước khi gửi biên bản kiểm định.'
          : `CẢNH BÁO LỆCH THIẾT BỊ (BR-05): Flight Controller kết nối thuộc về ${this.fcDrone()?.code || 'drone khác'}, nhưng hồ sơ yêu cầu ${drone?.code || droneId}.`,
      );
      return;
    }

    const fcMatches = this.isFcConnected() && this.isFcMatchingAssessmentDrone();
    const metrics = buildInspectionChecklist({
      preset: this.inspectionPreset(),
      batteryLevel: this.checklistBatteryLevel(),
      gpsSatellites: this.checklistGpsSats(),
      rfLinkQuality: this.checklistRfQuality(),
      flightControllerConnected: fcMatches,
    });
    const notes =
      this.checklistNotes().trim() || 'Kiểm định kỹ thuật trước nhiệm vụ';

    this.checklistSubmitting.set(true);
    this.inspecting.set(true);
    this.actionMessage.set('');
    this.error.set('');
    const a = this.item();

    this.api
      .runTechnicalInspection(droneId, {
        flightControllerUid: fcMatches ? this.fcMetadata()?.uid : null,
        preMissionAssessmentId: a?.id,
        notes,
        policyVersion: 'v2.0',
        metrics,
      })
      .subscribe({
        next: (res) => {
          this.inspectionResult.set(res);
          this.checklistSubmitting.set(false);
          this.inspecting.set(false);
          this.showChecklistModal.set(false);
          this.applyInspectionResultToAssessment(res);
          const code = drone?.code || droneId;
          const passed = res.eligibility === 'ELIGIBLE' && (res.status || '').toLowerCase() === 'passed';
          this.actionMessage.set(
            `Đã lưu biên bản kiểm định cho ${code}. Kết quả: ${passed ? 'Đạt' : 'Không đạt'} (sức khỏe ${res.overallHealth}).`,
          );

          this.realtime.broadcastAssessmentEvent({
            assessmentId: a?.id || '',
            type: 'DroneInspectionCompleted',
            status: passed ? 'PASS' : 'FAIL',
            droneId: res.droneId,
            droneCode: code,
            technicalHealth: res.overallHealth,
            technicalStatus: res.status,
            timestamp: new Date().toISOString(),
          });

          if (!a) return;
          // Re-evaluation needs manager scope for the region; technicians hand it over to the manager.
          if (!this.canManage()) {
            this.actionMessage.update(
              (msg) => `${msg} Quản lý cần bấm “Đánh giá lại” để cập nhật kết quả của hồ sơ.`,
            );
            return;
          }
          this.api.reEvaluate(a.id).subscribe({
            next: (updated) => {
              this.item.set(updated);
              this.actionMessage.set(
                `Biên bản kiểm định cho ${code} đã được lưu. Hồ sơ đã được đánh giá lại: ${statusLabel(updated.status) || updated.status}.`,
              );
            },
            error: (err: unknown) =>
              this.error.set(describeHttpError(err, 'Đã lưu biên bản nhưng chưa thể đánh giá lại hồ sơ. Vui lòng bấm “Đánh giá lại”.')),
          });
        },
        error: (err: unknown) => {
          this.checklistSubmitting.set(false);
          this.inspecting.set(false);
          this.error.set(describeHttpError(err, 'Không thể lưu biên bản kiểm định kỹ thuật. Vui lòng thử lại.'));
        },
      });
  }

  protected setMapType(mode: LocalMapMode): void {
    this.currentMapType.set(mode);
    this.applyMapMode(mode);
  }

  private initOrUpdateMap(): void {
    if (this.activeTab() !== 'overview') {
      this.cleanupMap();
      return;
    }
    const container = this.scopeMapContainer()?.nativeElement;
    if (!container) return;

    if (this.map && this.map.getContainer() !== container) this.cleanupMap();

    const validTowers = this.getValidScopeTowers();
    const resolvedMode = resolveLocalMapMode(
      validTowers.map((t) => ({ latitude: t.latitude!, longitude: t.longitude! })),
      this.currentMapType(),
    );
    this.currentMapType.set(resolvedMode);

    if (!this.map) {
      this.appliedMapMode = resolvedMode;
      const map = createLocalGisMap(container, {
        mode: resolvedMode,
        center: DEFAULT_LOCAL_MAP_CENTER,
        zoom: DEFAULT_LOCAL_MAP_ZOOM,
        onFallbackToSchematic: () => this.handleSchematicFallback(),
      });
      if (!map) return;
      this.map = map;
      if (typeof ResizeObserver !== 'undefined') {
        this.resizeObserver = new ResizeObserver(() => this.map?.resize());
        this.resizeObserver.observe(container);
      }
    }

    this.map.resize();
    this.renderScopeOnMap();
  }

  private renderScopeOnMap(): void {
    const orderedTowers = this.getValidScopeTowers();
    const resolvedMode = resolveLocalMapMode(
      orderedTowers.map((t) => ({ latitude: t.latitude!, longitude: t.longitude! })),
      this.currentMapType(),
    );
    if (resolvedMode !== this.currentMapType()) {
      this.currentMapType.set(resolvedMode);
    }

    const coords: [number, number][] = orderedTowers.map((t) => [t.longitude!, t.latitude!]);
    this.routeCoords = coords;
    if (!this.map) return;

    this.applyMapMode(resolvedMode);
    this.clearMarkers();

    orderedTowers.forEach((tower, idx) => {
      const stepNumber = idx + 1;
      const isStart = idx === 0;
      const isEnd = orderedTowers.length > 1 && idx === orderedTowers.length - 1;
      const element = this.createScopePinElement(stepNumber, tower.towerCode, isStart, isEnd);
      const marker = new Marker({ element, anchor: 'left' }).setLngLat(coords[idx]).addTo(this.map!);
      this.markers.push(marker);
    });

    setLocalGisRouteLine(this.map, coords, { color: '#1d4f91', width: 3 });

    if (coords.length > 1) {
      // Mũi tên chỉ hướng bay tại trung điểm mỗi chặng từ cột i -> cột i+1
      for (let i = 0; i < coords.length - 1; i++) {
        const [lng1, lat1] = coords[i];
        const [lng2, lat2] = coords[i + 1];
        const midCoord: [number, number] = [(lng1 + lng2) / 2, (lat1 + lat2) / 2];
        const p1 = this.map.project([lng1, lat1]);
        const p2 = this.map.project([lng2, lat2]);
        const angleDeg = (Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180) / Math.PI;
        const arrowEl = this.createDirectionArrowElement(angleDeg);
        const arrowMarker = new Marker({ element: arrowEl }).setLngLat(midCoord).addTo(this.map);
        this.markers.push(arrowMarker);
      }
    }

    if (coords.length) {
      fitLocalGisBounds(this.map, coords, 52, 16);
    }
  }

  protected refreshMap(): void {
    if (this.map) {
      this.map.resize();
      this.renderScopeOnMap();
    } else {
      this.initOrUpdateMap();
    }
  }

  /** Lọc bỏ an toàn cột có tọa độ hỏng để không làm lỗi hoặc mất toàn bộ bản đồ phạm vi. */
  private getValidScopeTowers() {
    return filterValidCoordinates(this.scopeTowers(), (t) => ({
      latitude: t.latitude,
      longitude: t.longitude,
    }));
  }

  private applyMapMode(mode: LocalMapMode): void {
    if (!this.map || this.appliedMapMode === mode) return;
    this.appliedMapMode = mode;
    this.map.setStyle(buildLocalGisStyle(mode));
    // setStyle xóa nguồn GeoJSON tuyến bay nên cần gắn lại sau khi style mới nạp xong.
    setLocalGisRouteLine(this.map, this.routeCoords, { color: '#1d4f91', width: 3 });
  }

  private handleSchematicFallback(): void {
    this.appliedMapMode = 'schematic';
    this.currentMapType.set('schematic');
    if (this.map && this.routeCoords.length > 1) {
      setLocalGisRouteLine(this.map, this.routeCoords, { color: '#1d4f91', width: 3 });
    }
  }

  private createScopePinElement(stepNumber: number, towerCode: string, isStart: boolean, isEnd: boolean): HTMLDivElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'ws-map-pin-wrapper';
    wrapper.style.display = 'inline-flex';
    wrapper.style.alignItems = 'center';
    wrapper.style.gap = '6px';

    const pin = document.createElement('span');
    pin.className = 'ws-map-tower-pin';
    if (isStart) pin.classList.add('is-start');
    else if (isEnd) pin.classList.add('is-end');
    pin.textContent = String(stepNumber);

    const label = document.createElement('span');
    label.className = 'ws-map-tower-label';
    let roleTag = '';
    if (isStart) roleTag = ' (Bắt đầu)';
    else if (isEnd) roleTag = ' (Kết thúc)';
    label.textContent = `${stepNumber}. ${towerCode}${roleTag}`;

    wrapper.appendChild(pin);
    wrapper.appendChild(label);
    return wrapper;
  }

  private createDirectionArrowElement(angleDeg: number): HTMLDivElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'ws-map-dir-wrapper';
    wrapper.style.pointerEvents = 'none';

    const arrow = document.createElement('div');
    arrow.className = 'ws-map-dir-arrow';
    arrow.style.transform = `rotate(${angleDeg.toFixed(1)}deg)`;

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('fill', 'none');

    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', 'M2 3.5L13.5 8L2 12.5L4.8 8L2 3.5Z');
    path.setAttribute('fill', '#1d4f91');
    path.setAttribute('stroke', '#ffffff');
    path.setAttribute('stroke-width', '1.2');
    path.setAttribute('stroke-linejoin', 'round');

    svg.appendChild(path);
    arrow.appendChild(svg);
    wrapper.appendChild(arrow);
    return wrapper;
  }

  private scheduleMapUpdate(delayMs: number): void {
    if (this.mapInitTimer !== null) clearTimeout(this.mapInitTimer);
    this.mapInitTimer = setTimeout(() => {
      this.mapInitTimer = null;
      this.initOrUpdateMap();
    }, delayMs);
  }

  private clearMarkers(): void {
    for (const marker of this.markers) marker.remove();
    this.markers = [];
  }

  private cleanupMap(): void {
    if (this.mapInitTimer !== null) {
      clearTimeout(this.mapInitTimer);
      this.mapInitTimer = null;
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.clearMarkers();
    if (!this.map) return;
    try {
      this.map.remove();
    } catch {
      // Bỏ qua nếu instance bản đồ đã bị hủy trước đó
    }
    this.map = null;
  }
}
