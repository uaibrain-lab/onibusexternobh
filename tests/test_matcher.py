import unittest
from transit.matcher import ShapeMatcher
class MatcherTests(unittest.TestCase):
    def setUp(self):
        self.matcher=ShapeMatcher({
          'north':[[-19.91,-43.95],[-19.90,-43.95],[-19.89,-43.95],[-19.88,-43.95]],
          'east':[[-19.91,-43.95],[-19.91,-43.94],[-19.91,-43.93],[-19.91,-43.92]]}, [])
    def samples(self):return [
       {'lat':-19.907,'lng':-43.95001,'heading':0,'fixAt':'A'},
       {'lat':-19.903,'lng':-43.95001,'heading':0,'fixAt':'B'},
       {'lat':-19.898,'lng':-43.95001,'heading':0,'fixAt':'C'}]
    def test_identifies_unique_shape_with_three_moving_fixes(self):
        result=self.matcher.resolve(['north','east'],self.samples())
        self.assertEqual(result['shapeId'],'north');self.assertEqual(result['status'],'probable')
    def test_does_not_guess_with_one_fix(self):
        result=self.matcher.resolve(['north','east'],self.samples()[:1])
        self.assertEqual(result['status'],'ambiguous');self.assertIsNone(result['shapeId'])
    def test_parallel_shapes_identical_are_ambiguous(self):
        self.matcher.shapes['northcopy']=self.matcher.shapes['north'][:]
        result=self.matcher.resolve(['north','northcopy'],self.samples())
        self.assertEqual(result['status'],'ambiguous')
if __name__=='__main__': unittest.main()
