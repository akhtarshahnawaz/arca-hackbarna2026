# ARCA pitch

> Deepfire tells us where the fire may go. ARCA tells us who may be in danger and who needs help first.

ARCA is an AI emergency assistant that identifies which people, buildings and animals are threatened by a wildfire, decides who may need help first, and helps a human coordinator contact them.

“Decides who may need help first” is the ranking engine (plain TypeScript). The AI explains. The formula ranks.

## 60 seconds

During a wildfire, the problem is not simply detecting the fire. Emergency teams already have satellite data, weather information and fire-spread models. The difficult part is turning all of that into an immediate decision: who is at risk, who needs the longest to evacuate and whom should we contact first?

ARCA is an AI emergency assistant that connects fire-spread predictions with information about hospitals, care homes, schools, farms and animal shelters. It calculates urgency by comparing the time before the fire may arrive with the time each location may need to evacuate.

It then gives the emergency coordinator a prioritised recommendation. The coordinator remains in control and must approve any external message. ARCA does not place the call. The coordinator places the call.

In short, Deepfire predicts where the fire may go. ARCA determines who may be affected and helps coordinators act before valuable evacuation time is lost.

## Six beats

1. **Human problem.** During a wildfire, emergency teams do not suffer from a lack of data. They suffer from having too much fragmented data and too little time to turn it into action.

2. **Missing answer.** A fire-spread map can show where the fire may go, but it does not tell the coordinator which care home, school or farm needs to be contacted first. A map may show that a fire will reach a particular area in three hours. That is the gap. ARCA does not promise a flat three hours; it speaks in “in N of 10 runs”.

3. **ARCA.** ARCA is an AI emergency assistant that converts wildfire predictions into a prioritised evacuation plan.

4. **Intelligence.** ARCA does not rank locations only by distance. It compares the estimated time before the fire arrives with the time each location may need to evacuate (`spare_time`). Filter first, then rank. Watch list separate.

5. **Human control.** The system recommends an action, but a human coordinator must approve any external message. The coordinator places the call.

6. **Impact.** This gives vulnerable facilities more warning, reduces the time coordinators spend combining different datasets and includes farms, shelters and residents with animals in the evacuation picture. People delay or refuse evacuation because of their animals. Pets are family. Livestock is income.
