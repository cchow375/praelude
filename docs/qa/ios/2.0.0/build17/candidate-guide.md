# Build17 camera acceptance guide

Candidate only until guarded delivery is recorded. Friend iPad remains held.

Open Score options → Camera gestures → Enable camera. On supported hardware the preview identifies **3D face tracking** and shows the current projected mesh-point count. The count can vary when part of the face is outside the image. Unsupported hardware retains the Vision landmarks backend. Frames and face measurements are processed locally and discarded, never saved or shared.

Relax in your normal piano position for automatic calibration. Nod naturally and return, shake from one side to the other and return, or grin briefly and relax. The detector now arms each expression independently and tolerates asymmetric head movements and short missing measurements. Ordinary blinks still do not count as deliberate eye closure. Recalibrate after a substantial change of position. Command-first mappings, sensitivity, expression hold and command interval remain customizable.

First verify expression labels in settings, where actions are paused. Then choose Done and check page commands on the score. Rep commands require Allow gestures to record reps, a running set, a completed first-attempt choice and score focus off. Verify exactly one saved repetition per expression, no repetition while settings are open, and no late page turn after leaving the score. Check responsiveness with preview visible and hidden. The candidate performs expensive library preparation away from the UI actor; atomic file replacement remains on the UI actor, and real-device latency is not established by Simulator tests.

Next steps: record actual-device backend, mesh visibility, natural nod/shake/grin recognition and page/rep response. Do not convert synthetic tests into a physical accuracy claim.
