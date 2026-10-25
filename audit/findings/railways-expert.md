# Indian railways and history findings (RAIL)

Written by the lead after the parallel agent was stopped by the usage limit (see the note in
ui-designer.md). Every claim below was checked against the sources named; where sources
disagree, the fix picks the best-supported figure or softens the claim.

## 1. Summary
- The stories and facts are careful and mostly right. Eleven claims are wrong or out of date:
  the Vivek Express's launch year and route, the Konkan Railway's length, tunnels and death toll,
  the Nilgiri train's speed, the WAP-7's power, the Bhor Ghat's tunnels, the Pamban bridge in
  the 1964 cyclone, the Kashmir line's foundation stone, the Himsagar's distance, and the date of
  the Kalka Mail's renaming.
- The data spot-check found one wrong train name: 12311/12312 still shows as "Kalka Mail",
  renamed the Netaji Express in January 2021.
- Hill towns reached by a toy train (Shimla) are described as "by road" only.

## 2. Extras

### 2a. Fact-check (stories and facts in content/discover.json)
| Item | Claim | Verdict | Correct version | Source |
|---|---|---|---|---|
| konkan-railway, fact 33 | 756 km, 92 tunnels, more than 2,000 bridges | partly | about 740 km, 91 tunnels, more than 2,000 bridges | [KRCL salient features](https://konkanrailway.com/salient_features) |
| konkan-railway | 74 people died building it | unverified (sources give 10, 19, 74) | "and lives were lost building it" | [Down To Earth](https://www.downtoearth.org.in/amp/story/environment/on-track-to-disaster-15627) |
| konkan-railway | Karbude 6.5 km, Sharavathi 2 km, first train Udupi–Mangaluru 1993, opened 26 Jan 1998 | correct | | KRCL; Wikipedia |
| fact 60 | first surveyed 1920, opened 78 years later | correct | | [Konkan Railway zone](https://en.wikipedia.org/wiki/Konkan_Railway_zone) |
| dudhsagar, fact 61 | 310 m, four tiers, on the line to Belagavi | correct | "Castle Rock ghat" is better named the Braganza Ghat | Wikipedia: Dudhsagar Falls |
| nilgiri, fact 27 | climbs at about 15 km/h | wrong | about 10 km/h on average; 13 km/h is the limit on the rack | [UNESCO nomination](https://whc.unesco.org/document/154650); [Outlook Traveller](https://www.outlooktraveller.com/explore/features/tamil-nadu-all-aboard-the-nilgiri-mountain-railway) |
| nilgiri | only rack railway; Coonoor 1899, Ooty 1908; UNESCO 2005; 46 km in about 5 h | correct | | Wikipedia; UNESCO |
| darjeeling | 1879–81, 610 mm, Batasia 1919, Ghum 2,258 m, UNESCO 1999 | correct | | Wikipedia: DHR, Ghum |
| darjeeling, fact 62 | five or six days before 1878 | correct per Wikipedia, others differ | keep, with Wikipedia as source | [Ghum railway station](https://en.wikipedia.org/wiki/Ghum_railway_station) |
| kalka-shimla, fact 34 | 1898–1903, 762 mm, 107 tunnels (102 in use), 900+ curves, 48°, UNESCO 2008 | correct | | Wikipedia |
| pamban | "It survived the 1964 cyclone" | wrong | the 1964 cyclone wrecked it; E. Sreedharan's team had it back in 46 days | [Pamban Bridge](https://en.wikipedia.org/wiki/Pamban_Bridge); [E. Sreedharan](https://en.wikipedia.org/wiki/E._Sreedharan) |
| pamban, facts 31–32 | 1914; closed Dec 2022; new bridge April 2025, 2.07 km, 72 m lift span | correct | | Wikipedia |
| kashmir | "planned in the 1970s; foundation stone laid in 1983" | partly | the 1983 stone (14 April, Indira Gandhi) was for Jammu–Udhampur; the line on to Srinagar and Baramulla was sanctioned in 1995 | [PIB, 2005](https://www.pib.gov.in/newsite/erelcontent.aspx?relid=8500); [Tribune](https://www.tribuneindia.com/news/j-k/udhampur-baramulla-rail-link-project-fully-operational-after-28-yrs) |
| kashmir, facts 28–30 | Chenab 359 m, opened 6 June 2025; Anji Khad 96 cables, 193 m pylon; Pir Panjal 11.2 km | correct | | Wikipedia |
| longest-rides | "launched in 2013" | wrong | first ran 19 November 2011 (for the 150th birth anniversary, 2013) | [Dibrugarh–Kanniyakumari Vivek Express](https://en.wikipedia.org/wiki/Dibrugarh%E2%80%93Kanniyakumari_Vivek_Express) |
| longest-rides, fact 18 | about 4,100 km, a little over three days; eight states, Jharkhand without stopping | partly | about 4,200 km (our timetable: 4,256 km) in about 80 hours; nine states, Jharkhand included | same; our db/halts.csv 15906 |
| longest-rides, fact 19 | Himsagar about 3,720 km | partly | about 3,790 km | [Himsagar Express](https://en.wikipedia.org/wiki/Himsagar_Express) |
| deccan-queen, fact 14 | 1 June 1930, weekend train for the Pune races, its "firsts" | correct | | [Deccan Queen](https://en.wikipedia.org/wiki/Deccan_Queen) |
| deccan-queen, fact 37 | Bhor Ghat 1863 with 28 tunnels | partly | 25 tunnels on the incline (28 is uncited) | [FIBIS](https://wiki.fibis.org/w/Bhore_Ghat_Railway_Construction); [Bhor Ghat](https://en.wikipedia.org/wiki/Bhor_Ghat) |
| araku, fact 40 | 1960s, Japanese help, 58 tunnels, 84 bridges | correct | | Wikipedia: KK line |
| first-rajdhani, fact 9 | 1 March 1969, 1,450 km, 17 h 20 m | correct | | Wikipedia |
| netaji-express, fact 6 | started 1 July 1866 to carry the government between Calcutta and Shimla | partly | it ran Howrah–Delhi at first and reached Kalka in 1891 | [Netaji Express](https://en.wikipedia.org/wiki/Netaji_Express) |
| netaji-express, fact 7 | Bose boarded at Gomoh, night of 17 January 1941 | correct per Wikipedia; one researcher disputes it | "is said to have boarded" | same; [Morung Express](https://morungexpress.com/researcher-shares-netajis-great-escape-route) |
| netaji-express | renamed "on 21 January 2021" | partly | renamed in January 2021 (announced 19–20 January) | [ETV Bharat](https://www.etvbharat.com/english/bharat/railways-renames-howrah-kalka-mail-as-netaji-express/na20210120092157531) |
| frontier-mail, fact 24 | 1928, ice slabs, renamed 1996, about 1,890 km in 29 h | correct (our timetable: 1,885 km, 29 h) | | Wikipedia; db/halts.csv 12903 |
| fact 10 | first Shatabdi New Delhi–Gwalior, 1988 | correct (10 July 1988; soon to Jhansi, later Bhopal) | | [Shatabdi Express](https://en.wikipedia.org/wiki/Shatabdi_Express) |
| fact 20 | first Vande Bharat 15 Feb 2019; 183 km/h in trials | correct (180–183 km/h reported) | | Wikipedia: Vande Bharat (trainset) |
| fact 21 | VB sleeper from January 2026, 16 coaches | correct (17 January 2026, Howrah–Guwahati) | | [The Statesman](https://www.thestatesman.com/india/india-gets-its-first-vande-bharat-sleeper-pm-modi-flags-off-howrah-guwahati-train-from-west-bengals-malda-1503542073.html) |
| fact 26 | WAP-7 6,125 hp | wrong | 6,350 hp at its peak (6,120 hp continuous) | [WAP-7](https://en.wikipedia.org/wiki/Indian_locomotive_class_WAP-7) |
| fact 39 | 99.2% electrified by November 2025 | correct (99.6% by July 2026) | update to the newer figure | [Drishti (Lok Sabha reply)](https://www.drishtiias.com/daily-updates/daily-news-analysis/indian-railways-electrification-drive/print_manually) |
| fact 41 | Kangra Valley 164 km, 950 bridges | correct | | [Kangra Valley Railway](https://en.wikipedia.org/wiki/Kangra_Valley_Railway) |
| fact 43 | Bhawani Mandi: north end MP, south end Rajasthan | correct | | [Bhawani Mandi station](https://en.wikipedia.org/wiki/Bhawani_Mandi_railway_station) |
| fact 45 | MGR Central second-longest in the world | contested by letter counts | "often called the second-longest in the world" | [Curly Tales](https://curlytales.com/chennai-central-lost-the-title-of-worlds-longest-railway-station-name-title-by-one-letter/amp/) |
| facts 52–53 | 6.9 billion passengers in 2023–24; 69,181 route km | correct | | [IR Annual Report 2023-24](https://indianrailways.gov.in/railwayboard/uploads/directorate/stat_econ/2025/Indian%20Railways%20Annual%20Report%20%20Accounts%202023-24%20-English.pdf) |
| other facts (1–5, 8, 11–13, 15–17, 22–23, 25, 29, 35–36, 38, 42, 44, 46–51, 54–59) | | correct to the best of the sources given with each | | as listed |

### 2b. Data spot-check (db/, as the site shows it)
| Train | What we show | What's true | Verdict |
|---|---|---|---|
| 12311/12312 | "Kalka Mail" | Netaji Express since January 2021 | wrong name |
| 12903 Golden Temple Mail | Bandra Terminus 18:45 → Amritsar 23:45 next day, 1,885 km, daily | runs daily Mumbai–Amritsar, ~1,890 km | consistent |
| 12123 Deccan Queen | CSMT 17:10 → Pune 20:25, 174 km, daily | daily, CSMT–Pune | consistent |
| 15906 Vivek Express | Dibrugarh 23:05 → Kanniyakumari 09:50 (+4), 4,256 km, 58 stops; running days unknown (2017 data) | ~4,189–4,286 km, 80+ h | consistent; running days missing |
| 16317 Himsagar | Fridays, 3,721 km to Katra | weekly; 3,790 km | distance short (route data) |
| 16592 Hampi Express | Bengaluru 21:50 → Hosapete 07:05, daily | daily overnight | consistent |
| 52541 Darjeeling toy train | type Pass | DHR toy train | consistent (shown with the toy-train tag through `Toy` type where set) |

### 2c. Representation
Landing: starts are the six biggest cities; hill towns include the North-East (Gangtok, Tawang),
Ladakh (Leh) and the south (Munnar, Kodaikanal, Madikeri); ideas are south, north and west.
Stories cover every region but central India and the North-East's own lines; the Vivek Express
story starts in Assam. Nothing stereotyped or disrespectful found; religious places are named
plainly. The removed "it's India, ji" joke about late trains was the only line that leaned on a
national stereotype (CW-18, done).

### 2d. Proposed new content (verified; to add)
- The New Pamban Bridge's lift span and the 1964 restoration (fold into the pamban story).
- The Vande Bharat sleeper (already a fact; keep current).
Further stories (central India's Patalpani–Kalakund line, Mizoram's Bairabi–Sairang line) need
their own sourcing before they're written; listed as next steps, not added.

## 3. Findings

| ID | Expert | Location (page/component/file:line) | Issue + evidence | Principle/source | Severity | Fix |
|---|---|---|---|---|---|---|
| RAIL-01 | RAIL | content/discover.json longest-rides body[1], fact 18 | Vivek Express "launched in 2013"; "eight states… Jharkhand without stopping"; "about 4,100 km in a little over three days" | Accuracy (2a) | High | "The first Vivek Express trains ran in 2011, part of the celebrations of Swami Vivekananda's 150th birth anniversary." · "It crosses nine states: Assam, Nagaland, West Bengal, Bihar, Jharkhand, Odisha, Andhra Pradesh, Tamil Nadu and Kerala." · "about 4,200 km in about 80 hours" |
| RAIL-02 | RAIL | konkan-railway body[1], fact 33 | 756 km, 92 tunnels, 74 deaths | Accuracy | High | "The 740 km line needed more than 2,000 bridges and 91 tunnels… Soft soil made some tunnels collapse again and again, and lives were lost building it." Fact: "more than 2,000 bridges and 91 tunnels along about 740 km of coast" |
| RAIL-03 | RAIL | nilgiri body[1], fact 27 | "about 15 km/h" | Accuracy | High | "the train moves at about 10 km/h on average, slower than a bicycle" (13 km/h is the rack's limit) |
| RAIL-04 | RAIL | fact 26 | WAP-7 "6,125 horsepower" | Accuracy | Med | "6,350 horsepower at its peak" |
| RAIL-05 | RAIL | deccan-queen body[1], fact 37 | Bhor Ghat "28 tunnels" | Accuracy | Med | "25 tunnels" |
| RAIL-06 | RAIL | pamban body[0] | "It survived the 1964 cyclone" | Accuracy | High | "The cyclone of December 1964 wrecked it; a team led by E. Sreedharan had it carrying trains again in 46 days. It then ran for more than a century…" |
| RAIL-07 | RAIL | kashmir body[0] | foundation stone 1983 attributed to the Kashmir line | Accuracy | Med | "The first stretch, Jammu to Udhampur, had its foundation stone laid in 1983; the line on to Srinagar and Baramulla was sanctioned in 1995." |
| RAIL-08 | RAIL | longest-rides body[2], fact 19 | Himsagar "about 3,720 km" | Accuracy | Low | "about 3,790 km" |
| RAIL-09 | RAIL | netaji-express body[0–1], facts 6–7 | 1866 train "to carry the government between Calcutta and Shimla" (it reached Kalka in 1891); renaming "on 21 January 2021"; Bose's boarding is disputed by one researcher | Accuracy | Med | "It ran from Howrah to Delhi at first, and reached Kalka in 1891." · "In January 2021…" · "is said to have boarded it at Gomoh" |
| RAIL-10 | RAIL | db: 12311/12312 name | "Kalka Mail" shown for the Netaji Express | Accuracy (renamed Jan 2021) | High | db/overrides.csv: name "Netaji Express" for both; rebuild the data |
| RAIL-11 | RAIL | Hills lens note, app.ts:1672 | Shimla, Darjeeling-type towns: "Train to Kalka, then 2h 45m by road" with no mention of the toy train | Railway knowledge; match with real world | Med | Name the toy train when one links the two (same as UX-05) |
| RAIL-12 | RAIL | dudhsagar body[2] | "the Castle Rock ghat" | Naming | Low | "the Braganza Ghat, between Castle Rock and Kulem" |
| RAIL-13 | RAIL | fact 39 | 99.2% (Nov 2025) superseded | Currency | Low | "More than 99% of India's broad-gauge network is electrified: 99.6% by July 2026." (source: [Deccan Chronicle](https://www.deccanchronicle.com/nation/india-electrifies-996-of-broad-gauge-rail-network-1973080)) |
| RAIL-14 | RAIL | fact 45 | "second in the world only to Llanfair…" stated flatly | Contested ranking | Low | "often called the second-longest in the world, after Llanfair… in Wales" |
| RAIL-15 | RAIL | Ooty naming (trip, map) | "Udhagamandalam" vs "Ooty" | Naming conventions | Low | Same as UX-09 |
