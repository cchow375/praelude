import Foundation

@main struct IndependentDirectionProbe {
    struct Result: Codable { let name: String; let passed: Bool; let actual: [String] }
    static func sample(_ t: Double, pitch: Double = 0, yaw: Double = 0, area: Double = 0.003,
                       faces: Int = 1, light: Double = 0.4, source: FaceGesturePoseSource = .vision) -> FaceGestureSample {
        FaceGestureSample(time: t, pitch: pitch, yaw: yaw, smileWidth: .nan,
                          luminance: light, confidence: 0.95, faceCount: faces, faceArea: area, poseSource: source)
    }
    static func ready(settings: FaceGestureSettings = .init(), pitch: Double = 0, yaw: Double = 0,
                      source: FaceGesturePoseSource = .vision) -> FaceGestureDetector {
        var d = FaceGestureDetector(); d.configure(settings: settings)
        precondition(d.calibrate((0...10).map { sample(Double($0) / 10, pitch: pitch, yaw: yaw, source: source) }))
        for t in [1.1, 1.2, 1.3] { _ = d.consume(sample(t, pitch: pitch, yaw: yaw, source: source)) }
        return d
    }
    static func collect(_ d: inout FaceGestureDetector, _ samples: [FaceGestureSample]) -> [String] {
        samples.compactMap { d.consume($0)?.rawValue }
    }
    static func main() throws {
        var results: [Result] = []
        func check(_ name: String, _ actual: [String], _ expected: [String]) {
            results.append(Result(name: name, passed: actual == expected, actual: actual))
        }
        do {
            let data = Data(#"{"nod":"again","shake":"clean","grin":"nextPage","mouthOpen":"sloppy","allowVerdicts":true,"sensitivity":"deliberate","holdDuration":0.7,"cooldown":2}"#.utf8)
            let s = try JSONDecoder().decode(FaceGestureSettings.self, from: data)
            let migrated = s.lookRight == .nextPage && s.lookLeft == .previousPage && s.lookDown == .again && s.nod == .off && s.grin == .off && s.shake == .clean && s.mouthOpen == .sloppy && s.allowVerdicts && s.sensitivity == .deliberate && s.holdDuration == 0.7 && s.cooldown == 2
            var custom = s; custom.assign(.lookDown, to: .sloppy)
            let reloaded = try JSONDecoder().decode(FaceGestureSettings.self, from: JSONEncoder().encode(custom))
            check("legacy_migration_and_new_customization_roundtrip", [String(migrated && reloaded == custom)], ["true"])
        }
        do {
            var d=ready(); var a=collect(&d,[sample(1.4,yaw:0.05),sample(1.48,yaw:0.10)])
            a += collect(&d,(0...10).map { sample(1.6+Double($0)*0.1,yaw:0.14) })
            a += collect(&d,[sample(2.7),sample(2.75,yaw:-0.12),sample(2.9),sample(3.0),sample(3.1),sample(3.2,yaw:-0.05),sample(3.28,yaw:-0.12)])
            check("onset_before_return_once_while_held_neutral_rearm_opposite",a,["lookRight","lookLeft"])
        }
        do {
            var d=ready(pitch:0.25,yaw:0.10)
            check("down_is_relative_to_normal_reading_posture",collect(&d,[sample(1.4,pitch:0.30,yaw:0.10),sample(1.48,pitch:0.38,yaw:0.10)]),["lookDown"])
        }
        do {
            var d=ready()
            let a=collect(&d,(0..<60).map { sample(1.4+Double($0)*0.08,pitch:$0.isMultiple(of:2) ? 0.02 : -0.02,yaw:$0.isMultiple(of:3) ? 0.025 : -0.02) })
            check("stationary_jitter_does_not_command",a,[])
        }
        do {
            var d=ready()
            check("equal_diagonal_motion_is_ambiguous",collect(&d,[sample(1.4,pitch:0.08,yaw:0.08),sample(1.48,pitch:0.135,yaw:0.12),sample(1.6)]),[])
        }
        do {
            var d=ready()
            let a=collect(&d,[sample(1.4,yaw:0.045),sample(1.48,yaw:0.075),sample(1.55,faces:0),sample(1.65),sample(1.7)])
            check("supported_short_loss_and_measured_neutral_complete_one_page",a,["lookRight"])
        }
        do {
            var s=FaceGestureSettings();s.assign(.lookRight,to:.clean)
            var d=ready(settings:s)
            check("loss_neutral_continuation_never_records_rep",collect(&d,[sample(1.4,yaw:0.045),sample(1.48,yaw:0.075),sample(1.55,faces:0),sample(1.65)]),[])
        }
        do {
            var d=ready()
            check("prolonged_absence_never_commands",collect(&d,[sample(1.4,yaw:0.045),sample(1.48,yaw:0.075),sample(1.85,faces:0),sample(1.95)]),[])
        }
        for (name,invalid) in [("multiple_faces_revoke_loss",sample(1.55,faces:2)),("dark_visible_face_revoke_loss",sample(1.55,light:0.01))] {
            var d=ready();check(name,collect(&d,[sample(1.4,yaw:0.045),sample(1.48,yaw:0.075),invalid,sample(1.65)]),[])
        }
        do {
            var d=ready();let a=collect(&d,[sample(1.4,yaw:0.05),sample(1.48,yaw:0.12,source:.arkit)])
            check("pose_source_switch_revokes_candidate_and_baseline",a+[String(d.baseline == nil)],["true"])
        }
        do {
            var d=ready(yaw:3.12)
            func wrap(_ x:Double)->Double { atan2(sin(x),cos(x)) }
            check("yaw_wraparound_uses_short_signed_difference",collect(&d,[sample(1.4,yaw:wrap(3.165)),sample(1.48,yaw:wrap(3.23))]),["lookRight"])
        }
        do {
            var d=ready()
            check("single_high_pose_spike_never_commands",collect(&d,[sample(1.4,yaw:0.20),sample(1.48)]),[])
        }
        do {
            var d=ready()
            check("slow_reading_posture_drift_never_commands",collect(&d,(0...60).map { sample(1.4+Double($0)*0.1,pitch:Double($0)*0.003) }),[])
        }
        do {
            var d=ready();d.resetMotion()
            check("missing_pitch_does_not_disable_measured_horizontal_look",collect(&d,[sample(1.4,pitch:.nan),sample(1.5,pitch:.nan),sample(1.6,pitch:.nan),sample(1.7,pitch:.nan,yaw:0.05),sample(1.78,pitch:.nan,yaw:0.12)]),["lookRight"])
        }
        let payload: [String:Any] = ["result":results.allSatisfy(\.passed) ? "passed":"failed","checks":results.count,"passed":results.filter(\.passed).count,"cases":try JSONSerialization.jsonObject(with:JSONEncoder().encode(results)),"scope":"Standalone current detector source; synthetic measurements, no capture, simulator or physical device operations."]
        let output=try JSONSerialization.data(withJSONObject:payload,options:[.prettyPrinted,.sortedKeys]);print(String(decoding:output,as:UTF8.self))
    }
}
